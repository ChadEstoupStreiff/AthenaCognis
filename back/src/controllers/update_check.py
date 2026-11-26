"""Compare the installed git commit with GitHub to tell whether a new version is out."""

import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from controllers.activity.github_client import (
    API_ROOT,
    REQUEST_TIMEOUT_SECONDS,
    Fetch,
    GitHubError,
    http_json,
    parse_repo,
)

# Repository .git mounted read-only into the container (see docker-compose.yml).
REPO_GIT_DIR = Path(os.environ.get("REPO_GIT_DIR", "/repo/.git"))
DEFAULT_BRANCH = "main"
REMOTE_NAME = "origin"
# One GitHub call per 10 minutes at most: anonymous API allows 60 calls per hour.
CACHE_TTL_SECONDS = 600.0
COMMIT_SHA = re.compile(r"^[0-9a-f]{40}$")
REF_PREFIX = "ref: "
BRANCH_PREFIX = "refs/heads/"
REMOTE_SECTION = f'[remote "{REMOTE_NAME}"]'
URL_LINE = re.compile(r"^\s*url\s*=\s*(?P<url>\S+)\s*$")

LOGGER = logging.getLogger(__name__)

UpdateState = Literal["up_to_date", "behind", "ahead", "diverged", "unknown"]
# GitHub compares base...head: "ahead" = head (GitHub) has commits the install lacks.
COMPARE_STATES: dict[str, UpdateState] = {
    "identical": "up_to_date",
    "ahead": "behind",
    "behind": "ahead",
    "diverged": "diverged",
}


class UpdateCheckError(RuntimeError):
    """Local repository unreadable."""


@dataclass(frozen=True)
class LocalRevision:
    """Installed commit and where it comes from."""

    commit: str
    branch: str
    repo: str


@dataclass(frozen=True)
class UpdateStatus:
    """Installed version compared with GitHub."""

    state: UpdateState
    behind_by: int
    local_commit: str
    reason: str
    checked_at: float


def resolve_ref(git_dir: Path, ref: str) -> str:
    """
    Read the commit a ref points to (loose file, then packed-refs)

    Args:
        git_dir (Path): .git directory
        ref (str): ref name, e.g. "refs/heads/main"
    Returns:
        str: commit SHA
    Raises:
        UpdateCheckError: ref not found
    """
    loose = git_dir / ref
    if loose.is_file():
        return loose.read_text().strip()
    packed = git_dir / "packed-refs"
    if packed.is_file():
        for line in packed.read_text().splitlines():
            parts = line.split(" ")
            if len(parts) == 2 and parts[1] == ref:
                return parts[0]
    raise UpdateCheckError(f"ref {ref} not found")


def read_head(git_dir: Path) -> tuple[str, str]:
    """
    Read the checked-out commit and branch

    Args:
        git_dir (Path): .git directory
    Returns:
        tuple[str, str]: commit SHA, branch name ("" when detached)
    Raises:
        UpdateCheckError: HEAD missing or unreadable
    """
    head_file = git_dir / "HEAD"
    if not head_file.is_file():
        raise UpdateCheckError(f"no git repository at {git_dir}")
    head = head_file.read_text().strip()
    if COMMIT_SHA.match(head):
        return head, ""
    if not head.startswith(REF_PREFIX):
        raise UpdateCheckError(f"unreadable HEAD: {head!r}")
    ref = head.removeprefix(REF_PREFIX)
    commit = resolve_ref(git_dir, ref)
    if not COMMIT_SHA.match(commit):
        raise UpdateCheckError(f"unreadable commit for {ref}")
    return commit, ref.removeprefix(BRANCH_PREFIX)


def read_origin_url(git_dir: Path) -> str:
    """
    Read the URL of the origin remote from .git/config

    Args:
        git_dir (Path): .git directory
    Returns:
        str: remote URL
    Raises:
        UpdateCheckError: config or origin remote missing
    """
    config = git_dir / "config"
    if not config.is_file():
        raise UpdateCheckError("no git config")
    in_origin = False
    for line in config.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            in_origin = stripped == REMOTE_SECTION
            continue
        match = URL_LINE.match(line)
        if in_origin and match is not None:
            return match["url"]
    raise UpdateCheckError(f"no {REMOTE_NAME} remote")


def read_local_revision(git_dir: Path) -> LocalRevision:
    """
    Read the installed commit, branch and GitHub repository

    Args:
        git_dir (Path): .git directory
    Returns:
        LocalRevision: installed revision
    Raises:
        UpdateCheckError: repository unreadable
        GitHubError: origin is not a GitHub repository
    """
    commit, branch = read_head(git_dir)
    repo = parse_repo(read_origin_url(git_dir))
    return LocalRevision(commit=commit, branch=branch or DEFAULT_BRANCH, repo=repo)


def compare_with_github(local: LocalRevision, fetch: Fetch) -> UpdateStatus:
    """
    Ask GitHub how the installed commit relates to the branch head

    Args:
        local (LocalRevision): installed revision
        fetch (Fetch): JSON fetcher
    Returns:
        UpdateStatus: comparison result
    Raises:
        GitHubError: request failed (e.g. commit never pushed)
    """
    url = f"{API_ROOT}/repos/{local.repo}/compare/{local.commit}...{local.branch}"
    payload = fetch(url, "", REQUEST_TIMEOUT_SECONDS)
    if not isinstance(payload, dict):
        raise GitHubError("unexpected compare answer")
    state = COMPARE_STATES.get(str(payload.get("status")), "unknown")
    ahead_by = payload.get("ahead_by")
    behind_by = ahead_by if isinstance(ahead_by, int) else 0
    return UpdateStatus(
        state=state,
        behind_by=behind_by,
        local_commit=local.commit,
        reason="",
        checked_at=time.time(),
    )


def check_update(git_dir: Path, fetch: Fetch) -> UpdateStatus:
    """
    Compare the installed version with GitHub, never raising

    Args:
        git_dir (Path): .git directory
        fetch (Fetch): JSON fetcher
    Returns:
        UpdateStatus: comparison, state "unknown" with a reason on failure
    """
    try:
        local = read_local_revision(git_dir)
    except (UpdateCheckError, GitHubError, OSError) as error:
        return unknown_status("", str(error))
    try:
        return compare_with_github(local, fetch)
    except GitHubError as error:
        return unknown_status(local.commit, str(error))


def unknown_status(local_commit: str, reason: str) -> UpdateStatus:
    """
    Build the status of a failed check

    Args:
        local_commit (str): installed commit, "" when unknown
        reason (str): why the check failed
    Returns:
        UpdateStatus: unknown status
    """
    LOGGER.info(f"Update check failed: {reason}")
    return UpdateStatus(
        state="unknown",
        behind_by=0,
        local_commit=local_commit,
        reason=reason,
        checked_at=time.time(),
    )


class UpdateChecker:
    """Update check with a shared cache, safe across request threads."""

    def __init__(self, git_dir: Path = REPO_GIT_DIR, fetch: Fetch = http_json) -> None:
        """
        Create a checker

        Args:
            git_dir (Path): .git directory
            fetch (Fetch): JSON fetcher
        Returns:
            None
        """
        self.git_dir = git_dir
        self.fetch = fetch
        self.lock = threading.Lock()
        self.cached: UpdateStatus | None = None

    def status(self, force: bool = False) -> UpdateStatus:
        """
        Return the update status, reusing a check younger than CACHE_TTL_SECONDS

        Args:
            force (bool): ignore the cache
        Returns:
            UpdateStatus: latest status
        """
        with self.lock:
            cached = self.cached
            is_fresh = cached is not None and time.time() - cached.checked_at < CACHE_TTL_SECONDS
            if cached is not None and is_fresh and not force:
                return cached
            self.cached = check_update(self.git_dir, self.fetch)
            return self.cached


UPDATE_CHECKER = UpdateChecker()

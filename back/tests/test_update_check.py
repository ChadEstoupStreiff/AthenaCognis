from pathlib import Path

import pytest

from controllers.activity.github_client import GitHubError
from controllers.update_check import (
    UpdateChecker,
    check_update,
    read_head,
    read_local_revision,
)

LOCAL_SHA = "a" * 40
CONFIG = """[core]
\tbare = false
[remote "upstream"]
\turl = https://github.com/other/fork.git
[remote "origin"]
\turl = git@github.com:owner/project.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
"""


def make_repo(root: Path, packed: bool = False, head: str = "ref: refs/heads/main") -> Path:
    """
    Write a minimal .git directory

    Args:
        root (Path): parent folder
        packed (bool): store the branch in packed-refs instead of a loose ref
        head (str): HEAD file content
    Returns:
        Path: .git directory
    """
    git_dir = root / ".git"
    (git_dir / "refs" / "heads").mkdir(parents=True)
    (git_dir / "HEAD").write_text(f"{head}\n")
    (git_dir / "config").write_text(CONFIG)
    if packed:
        (git_dir / "packed-refs").write_text(f"# pack-refs\n{LOCAL_SHA} refs/heads/main\n")
    else:
        (git_dir / "refs" / "heads" / "main").write_text(f"{LOCAL_SHA}\n")
    return git_dir


def fake_fetch(payload: object, calls: list[str]):
    """
    Build a fetcher returning a fixed payload and recording URLs

    Args:
        payload (object): answer
        calls (list[str]): receives every requested URL
    Returns:
        Callable[[str, str, float], object]: fetcher
    """

    def fetch(url: str, token: str, timeout: float) -> object:
        calls.append(url)
        return payload

    return fetch


@pytest.mark.parametrize("packed", [False, True])
def test_reads_branch_commit_and_origin(tmp_path: Path, packed: bool) -> None:
    revision = read_local_revision(make_repo(tmp_path, packed=packed))
    assert (revision.commit, revision.branch, revision.repo) == (LOCAL_SHA, "main", "owner/project")


def test_detached_head_uses_default_branch(tmp_path: Path) -> None:
    git_dir = make_repo(tmp_path, head=LOCAL_SHA)
    assert read_head(git_dir) == (LOCAL_SHA, "")
    assert read_local_revision(git_dir).branch == "main"


def test_new_commits_on_github_mean_behind(tmp_path: Path) -> None:
    calls: list[str] = []
    status = check_update(make_repo(tmp_path), fake_fetch({"status": "ahead", "ahead_by": 3}, calls))
    assert (status.state, status.behind_by, status.local_commit) == ("behind", 3, LOCAL_SHA)
    assert status.local_branch == "main"
    assert calls == [f"https://api.github.com/repos/owner/project/compare/{LOCAL_SHA}...main"]


def test_identical_is_up_to_date(tmp_path: Path) -> None:
    status = check_update(make_repo(tmp_path), fake_fetch({"status": "identical", "ahead_by": 0}, []))
    assert (status.state, status.behind_by) == ("up_to_date", 0)


def test_missing_repo_is_unknown(tmp_path: Path) -> None:
    status = check_update(tmp_path / ".git", fake_fetch({}, []))
    assert status.state == "unknown"
    assert "no git repository" in status.reason
    assert (status.local_commit, status.local_branch) == ("", "")


def test_github_error_is_unknown(tmp_path: Path) -> None:
    def failing(url: str, token: str, timeout: float) -> object:
        raise GitHubError("not found")

    status = check_update(make_repo(tmp_path), failing)
    assert (status.state, status.reason, status.local_commit) == ("unknown", "not found", LOCAL_SHA)
    assert status.local_branch == "main"


def test_checker_caches_until_forced(tmp_path: Path) -> None:
    calls: list[str] = []
    checker = UpdateChecker(make_repo(tmp_path), fake_fetch({"status": "identical"}, calls))
    checker.status()
    checker.status()
    assert len(calls) == 1
    checker.status(force=True)
    assert len(calls) == 2

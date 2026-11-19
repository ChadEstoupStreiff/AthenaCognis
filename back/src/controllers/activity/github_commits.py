"""Commits of watched repositories, shaped as events: pushes GitHub has not published yet."""

import logging
from collections.abc import Iterable

from controllers.activity.base import TimeRange
from controllers.activity.github_client import (
    PER_PAGE,
    GitHubClient,
    GitHubError,
    objects,
)
from controllers.activity.github_events import JsonObject, obj, text

LOGGER = logging.getLogger(__name__)

# Synthetic event type of one commit read from the Commits API.
COMMIT_EVENT = "CommitEvent"
PUSH_EVENT = "PushEvent"
ISO_UTC = "%Y-%m-%dT%H:%M:%SZ"


def commits_path(repo: str, window: TimeRange) -> str:
    """
    Commits API path of a repository default branch in a window

    Args:
        repo (str): "owner/repo"
        window (TimeRange): time window (naive UTC)
    Returns:
        str: path with since / until query
    """
    return (
        f"/repos/{repo}/commits?since={window.start:{ISO_UTC}}"
        f"&until={window.end:{ISO_UTC}}&per_page={PER_PAGE}"
    )


def commit_event(repo: str, commit: JsonObject) -> JsonObject:
    """
    Shape a Commits API item as an event

    Args:
        repo (str): "owner/repo"
        commit (JsonObject): Commits API item
    Returns:
        JsonObject: CommitEvent with id, created_at (committer date), actor, repo, payload
    """
    sha = text(commit, "sha")
    details = obj(commit, "commit")
    return {
        "id": f"commit-{sha}",
        "type": COMMIT_EVENT,
        "created_at": text(obj(details, "committer"), "date"),
        "actor": {"login": text(obj(commit, "author"), "login")},
        "repo": {"name": repo},
        "payload": {
            "sha": sha,
            "message": text(details, "message"),
            "html_url": text(commit, "html_url"),
        },
    }


def read_commits(
    client: GitHubClient, repos: Iterable[str], window: TimeRange
) -> list[JsonObject]:
    """
    Read the commits of each repository in the window, skipping unreadable ones

    Args:
        client (GitHubClient): client
        repos (Iterable[str]): "owner/repo" names
        window (TimeRange): time window
    Returns:
        list[JsonObject]: CommitEvents
    """
    found: list[JsonObject] = []
    for repo in repos:
        try:
            items = objects(client.get(commits_path(repo, window)))
        except GitHubError as error:
            LOGGER.info("GitHub commits of %s unavailable: %s", repo, error)
            continue
        found += [commit_event(repo, item) for item in items]
    return found


def pushed_shas(events: list[JsonObject]) -> set[str]:
    """
    Commits covered by push events: heads and listed commits

    Args:
        events (list[JsonObject]): events (pushes completed with their commits)
    Returns:
        set[str]: commit SHAs
    """
    shas: set[str] = set()
    for event in events:
        if text(event, "type") != PUSH_EVENT:
            continue
        payload = obj(event, "payload")
        shas.add(text(payload, "head"))
        raw = payload.get("commits")
        shas.update(text(item, "sha") for item in objects(raw))
    shas.discard("")
    return shas


def unpublished(commits: list[JsonObject], events: list[JsonObject]) -> list[JsonObject]:
    """
    Keep the commits no push event covers yet

    Args:
        commits (list[JsonObject]): CommitEvents
        events (list[JsonObject]): events (pushes completed with their commits)
    Returns:
        list[JsonObject]: CommitEvents not pushed as events
    """
    covered = pushed_shas(events)
    return [
        commit
        for commit in commits
        if text(obj(commit, "payload"), "sha") not in covered
    ]

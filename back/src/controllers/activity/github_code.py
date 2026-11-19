"""Code changes (diffs) of GitHub pushes, commits and pull requests."""

import logging
from collections.abc import Callable, Iterable, Sequence

from controllers.activity.github_client import PER_PAGE, GitHubClient, GitHubError, objects
from controllers.activity.github_events import JsonObject, obj, pull_number, text

LOGGER = logging.getLogger(__name__)

# Activities whose code is fetched (one API call each, pushes excepted).
MAX_CODE_EVENTS = 30
PULL_EVENTS = frozenset({"PullRequestEvent", "PullRequestReviewEvent"})

Tracker = Callable[[Sequence[JsonObject]], Iterable[JsonObject]]


def patches_of(files: object) -> list[JsonObject]:
    """
    File names and diffs of a GitHub "files" list (compare, commit or pull request)

    Args:
        files (object): JSON list of changed files
    Returns:
        list[JsonObject]: {"filename", "patch"} per file ("" patch for binary files)
    """
    return [
        {"filename": text(item, "filename"), "patch": text(item, "patch")}
        for item in objects(files)
    ]


def code_path(event: JsonObject) -> str:
    """
    API path listing the changed files of an event

    Args:
        event (JsonObject): event
    Returns:
        str: commit or pull request files path, "" when none (pushes carry theirs)
    """
    repo = text(obj(event, "repo"), "name")
    payload = obj(event, "payload")
    event_type = text(event, "type")
    if event_type == "CommitEvent" and text(payload, "sha"):
        return f"/repos/{repo}/commits/{text(payload, 'sha')}"
    if event_type in PULL_EVENTS and pull_number(payload):
        return f"/repos/{repo}/pulls/{pull_number(payload)}/files?per_page={PER_PAGE}"
    return ""


def add_code(event: JsonObject, client: GitHubClient) -> JsonObject:
    """
    Add the diff of a commit or pull request event (pushes get theirs when completed)

    Args:
        event (JsonObject): event
        client (GitHubClient): client
    Returns:
        JsonObject: event with payload "patches", unchanged when not fetchable
    """
    path = code_path(event)
    if not path or "patches" in obj(event, "payload"):
        return event
    try:
        answer = client.get(path)
    except GitHubError as error:
        LOGGER.info("GitHub code of %s unavailable: %s", text(event, "id"), error)
        return event
    files = answer.get("files") if isinstance(answer, dict) else answer
    payload = {**obj(event, "payload"), "patches": patches_of(files)}
    return {**event, "payload": payload}


def add_code_all(
    events: list[JsonObject], client: GitHubClient, track: Tracker
) -> list[JsonObject]:
    """
    Add the diffs of the first MAX_CODE_EVENTS events (newest first)

    Args:
        events (list[JsonObject]): events, newest first
        client (GitHubClient): client
        track (Tracker): wraps the events to report progress
    Returns:
        list[JsonObject]: events
    """
    head = [add_code(event, client) for event in track(events[:MAX_CODE_EVENTS])]
    return head + events[MAX_CODE_EVENTS:]

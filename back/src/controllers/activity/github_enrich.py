"""Complete slim GitHub events: commit messages of pushes, titles of pull requests."""

import logging
import re
from collections.abc import Callable, Iterable, Sequence

from controllers.activity.github_client import GitHubClient, GitHubError, objects
from controllers.activity.github_code import patches_of
from controllers.activity.github_events import JsonObject, obj, pull_number, text

LOGGER = logging.getLogger(__name__)

# Pushes creating a branch have an all-zero "before" commit: nothing to compare.
NULL_SHA = re.compile(r"^0+$")
# Lookups per feed: each costs one API call (cached).
MAX_ENRICHED = 50


def with_payload(event: JsonObject, changes: JsonObject) -> JsonObject:
    """
    Copy an event with payload keys replaced

    Args:
        event (JsonObject): event
        changes (JsonObject): payload keys to set
    Returns:
        JsonObject: new event
    """
    return {**event, "payload": {**obj(event, "payload"), **changes}}


def enrich_push(event: JsonObject, client: GitHubClient) -> JsonObject:
    """
    Add the commit messages of a push (Events API no longer lists them)

    Args:
        event (JsonObject): PushEvent
        client (GitHubClient): client
    Returns:
        JsonObject: event with payload "commits", unchanged when not comparable
    Raises:
        GitHubError: compare request failed
    """
    payload = obj(event, "payload")
    before, head = text(payload, "before"), text(payload, "head")
    if isinstance(payload.get("commits"), list) or not before or not head:
        return event
    if NULL_SHA.match(before):
        return event
    repo = text(obj(event, "repo"), "name")
    compare = client.get(f"/repos/{repo}/compare/{before}...{head}")
    raw = compare.get("commits") if isinstance(compare, dict) else None
    commits = [
        {"sha": text(item, "sha"), "message": text(obj(item, "commit"), "message")}
        for item in objects(raw)
    ]
    changed = compare.get("files") if isinstance(compare, dict) else None
    files = [text(item, "filename") for item in objects(changed)]
    return with_payload(
        event, {"commits": commits, "files": files, "patches": patches_of(changed)}
    )


def enrich_pull(event: JsonObject, client: GitHubClient) -> JsonObject:
    """
    Add the full pull request (title, body, link, merged) to a PR event

    Args:
        event (JsonObject): PullRequest(Review)(Comment)Event
        client (GitHubClient): client
    Returns:
        JsonObject: event with the full "pull_request", unchanged when already full
    Raises:
        GitHubError: pull request request failed
    """
    payload = obj(event, "payload")
    number = pull_number(payload)
    if text(obj(payload, "pull_request"), "title") or not number:
        return event
    repo = text(obj(event, "repo"), "name")
    pull = client.get(f"/repos/{repo}/pulls/{number}")
    return (
        with_payload(event, {"pull_request": pull}) if isinstance(pull, dict) else event
    )


Enricher = Callable[[JsonObject, GitHubClient], JsonObject]
ENRICHERS: dict[str, Enricher] = {
    "PushEvent": enrich_push,
    "PullRequestEvent": enrich_pull,
    "PullRequestReviewEvent": enrich_pull,
    "PullRequestReviewCommentEvent": enrich_pull,
}


def enrich(event: JsonObject, client: GitHubClient) -> JsonObject:
    """
    Complete one event when its type needs it; keep it as is on failure

    Args:
        event (JsonObject): event
        client (GitHubClient): client
    Returns:
        JsonObject: completed (or unchanged) event
    """
    enricher = ENRICHERS.get(text(event, "type"))
    if enricher is None:
        return event
    try:
        return enricher(event, client)
    except GitHubError as error:
        LOGGER.info("GitHub event %s not completed: %s", text(event, "id"), error)
        return event


Tracker = Callable[[Sequence[JsonObject]], Iterable[JsonObject]]


def untracked(events: Sequence[JsonObject]) -> Iterable[JsonObject]:
    """
    Pass events through without progress

    Args:
        events (Sequence[JsonObject]): events
    Returns:
        Iterable[JsonObject]: same events
    """
    return events


def enrich_all(
    events: list[JsonObject], client: GitHubClient, track: Tracker = untracked
) -> list[JsonObject]:
    """
    Complete the first MAX_ENRICHED events (newest first), keep the rest as is

    Args:
        events (list[JsonObject]): events, newest first
        client (GitHubClient): client
        track (Tracker): wraps the completed events to report progress
    Returns:
        list[JsonObject]: events
    """
    head = [enrich(event, client) for event in track(events[:MAX_ENRICHED])]
    return head + events[MAX_ENRICHED:]

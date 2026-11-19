from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pytest

from controllers.activity.base import (
    DataSource,
    InvalidSettingError,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.github_client import (
    API_ROOT,
    GitHubError,
    parse_org,
    parse_repo,
)
from controllers.activity.github_commits import commit_event, unpublished
from controllers.activity.github_events import event_activity
from controllers.activity.github_source import GitHubDataSource

DAY = datetime(2026, 11, 18)
WINDOW = TimeRange(DAY, DAY + timedelta(days=1))
TOKEN = "ghp_secret"
Settings = dict[str, object]
Event = dict[str, object]


def event(
    event_id: str, kind: str, hour: int, payload: Event, actor: str = "me"
) -> Event:
    """
    Build one Events API item

    Args:
        event_id (str): event id
        kind (str): event type
        hour (int): hour of the day
        payload (Event): payload
        actor (str): actor login
    Returns:
        Event: event
    """
    return {
        "id": event_id,
        "type": kind,
        "created_at": f"2026-11-18T{hour:02d}:00:00Z",
        "actor": {"login": actor},
        "repo": {"name": "me/app"},
        "payload": payload,
    }


PUSH = event(
    "1",
    "PushEvent",
    9,
    {
        "ref": "refs/heads/main",
        "before": "aaaaaaaaaaaaaaaa",
        "head": "bbbbbbbbbbbbbbbb",
        "commits": [{"message": "Fix login\n\nDetails"}, {"message": "Add tests"}],
    },
)
PULL = event(
    "2",
    "PullRequestEvent",
    10,
    {
        "action": "closed",
        "pull_request": {
            "number": 7,
            "title": "Speed up",
            "merged": True,
            "html_url": "https://github.com/me/app/pull/7",
            "body": "Faster",
        },
    },
)
OTHERS_REVIEW = event(
    "3",
    "PullRequestReviewEvent",
    11,
    {
        "review": {"state": "changes_requested", "body": "Nit"},
        "pull_request": {"number": 7, "title": "Speed up"},
    },
    actor="ann",
)
STAR = event("4", "WatchEvent", 12, {"action": "started"})
OLD = event("5", "IssuesEvent", 8, {"action": "opened", "issue": {"number": 1}})
OLD["created_at"] = "2026-11-16T08:00:00Z"
ORG_ISSUE = event(
    "6",
    "IssuesEvent",
    13,
    {
        "action": "opened",
        "issue": {"number": 3, "title": "Bug", "html_url": "https://x/3"},
    },
)


@dataclass
class FakeGitHub:
    """GitHub API answering from fixed data and recording calls."""

    is_up: bool = True
    calls: list[tuple[str, str]] = field(default_factory=list)

    def __call__(self, url: str, token: str, timeout: float) -> object:
        """
        Answer one GET

        Args:
            url (str): API URL
            token (str): token
            timeout (float): timeout
        Returns:
            object: decoded JSON
        Raises:
            GitHubError: API down
        """
        del timeout
        path = url.removeprefix(API_ROOT)
        self.calls.append((path, token))
        if not self.is_up:
            raise GitHubError("token rejected")
        answers: dict[str, object] = {
            "/user": {"login": "Me"},
            "/user/repos": [{"full_name": "me/new"}, {"full_name": "me/app"}],
            "/user/orgs": [{"login": "acme"}, {"login": "lab"}],
            "/repos/me/app/events": [STAR, OTHERS_REVIEW, PULL, PUSH, OLD],
            "/users/Me/events/orgs/acme": [ORG_ISSUE, PUSH],
            "/orgs/acme/events": [ORG_ISSUE],
            "/orgs/acme/repos": [{"full_name": "acme/api"}, {"full_name": "me/app"}],
            "/orgs/lab/repos": [{"full_name": "lab/notes"}],
        }
        return answers.get(path.split("?")[0], [])


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """
    Replace the data source settings with an editable dict, GitHub added

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Settings: settings
    """
    values: Settings = {
        "activity_github_added": True,
        "activity_github_token": TOKEN,
        "activity_github_repos": "https://github.com/me/app\n",
        "activity_github_orgs": "https://github.com/acme",
    }
    monkeypatch.setattr(DataSource, "read_setting", staticmethod(values.get))
    return values


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeGitHub:
    """
    Route GitHub requests to a fake API

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        FakeGitHub: API
    """
    fake = FakeGitHub()
    monkeypatch.setattr(GitHubDataSource, "fetch", staticmethod(fake))
    return fake


def test_parse_links() -> None:
    for link in (
        "https://github.com/me/app",
        "github.com/me/app.git",
        "git@github.com:me/app.git",
        "me/app",
        " https://www.github.com/me/app/ ",
    ):
        assert parse_repo(link) == "me/app"
    assert parse_org("https://github.com/orgs/acme") == "acme"
    assert parse_org("acme") == "acme"
    for bad in ("https://gitlab.com/me/app", "me", ""):
        with pytest.raises(GitHubError):
            parse_repo(bad)
    with pytest.raises(GitHubError):
        parse_org("me/app")


def test_bare_repo_name_error_shows_expected_format() -> None:
    with pytest.raises(GitHubError, match="use owner/repo"):
        parse_repo("PINKCC-Registration-Dev")


def test_event_activities() -> None:
    push = event_activity(PUSH)
    assert push is not None
    assert push.title == "Pushed 2 commits to main"
    assert push.summary == "Fix login; Add tests"
    assert push.link == "https://github.com/me/app/compare/aaaaaaaaaaaa...bbbbbbbbbbbb"
    assert push.details == {"repo": "me/app"}
    assert push.occurred_at == DAY.replace(hour=9)
    pull = event_activity(PULL)
    assert pull is not None
    assert pull.title == "Merged PR #7: Speed up"
    review = event_activity(OTHERS_REVIEW)
    assert review is not None
    assert review.title == "Review (changes requested) on PR #7: Speed up"
    assert event_activity(STAR) is None
    commitless = event_activity(event("9", "PushEvent", 9, {"ref": "refs/heads/dev"}))
    assert commitless is not None
    assert commitless.title == "Pushed to dev"
    assert commitless.link == "https://github.com/me/app/tree/dev"


def test_feed_only_mine_and_dedup(settings: Settings, api: FakeGitHub) -> None:
    source = GitHubDataSource()
    assert source.detail() == "1 repository · 1 organisation"
    feed = source.activities(WINDOW)
    assert [item.id for item in feed] == ["github:6", "github:2", "github:1"]
    assert all(token == TOKEN for _, token in api.calls)
    settings["activity_github_only_mine"] = False
    settings["activity_github_kinds"] = ["review", "push"]
    feed = source.activities(WINDOW)
    assert [item.id for item in feed] == ["github:3", "github:1"]


def test_anonymous_uses_public_feeds_and_username(
    settings: Settings, api: FakeGitHub
) -> None:
    del settings["activity_github_token"]
    source = GitHubDataSource()
    with pytest.raises(InvalidSettingError):
        source.activities(WINDOW)
    settings["activity_github_username"] = "me"
    feed = source.activities(WINDOW)
    assert [item.id for item in feed] == ["github:6", "github:2", "github:1"]
    paths = [path.split("?")[0] for path, _ in api.calls]
    assert "/orgs/acme/events" in paths
    assert "/user" not in paths


def test_suggestions_skip_watched(settings: Settings, api: FakeGitHub) -> None:
    fields = {item["key"]: item for item in GitHubDataSource().info().config}
    assert [item["value"] for item in fields["activity_github_repos"]["options"]] == [
        "me/new",
        "acme/api",
        "lab/notes",
    ]
    assert fields["activity_github_orgs"]["options"] == [
        {"value": "lab", "label": "lab"}
    ]
    assert fields["activity_github_token"]["secret"] is True


def test_suggestions_ask_ten_most_active_per_owner(
    settings: Settings, api: FakeGitHub
) -> None:
    GitHubDataSource().info()
    listings = [path for path, _ in api.calls if path.split("?")[0].endswith("/repos")]
    assert {path.split("?")[0] for path in listings} == {
        "/user/repos",
        "/orgs/acme/repos",
        "/orgs/lab/repos",
    }
    assert all("sort=pushed" in path and "per_page=10" in path for path in listings)


def test_errors(settings: Settings, api: FakeGitHub) -> None:
    source = GitHubDataSource()
    settings["activity_github_repos"] = "https://gitlab.com/x/y"
    with pytest.raises(InvalidSettingError):
        source.activities(WINDOW)
    settings["activity_github_repos"] = "me/app"
    api.is_up = False
    with pytest.raises(SourceUnavailableError) as error:
        source.activities(WINDOW)
    assert "token rejected" in str(error.value)
    assert TOKEN not in str(error.value)
    fields = {item["key"]: item for item in source.info().config}
    assert fields["activity_github_repos"]["options"] == []


def test_answers_are_cached(settings: Settings, api: FakeGitHub) -> None:
    source = GitHubDataSource()
    source.activities(WINDOW)
    count = len(api.calls)
    source.activities(WINDOW)
    assert len(api.calls) == count


SLIM_PUSH = event(
    "20",
    "PushEvent",
    14,
    {"ref": "refs/heads/main", "before": "a" * 40, "head": "b" * 40},
)
NEW_BRANCH_PUSH = event(
    "21",
    "PushEvent",
    15,
    {"ref": "refs/heads/feat", "before": "0" * 40, "head": "c" * 40},
)
SLIM_PULL = event(
    "22",
    "PullRequestEvent",
    16,
    {"action": "merged", "number": 9, "pull_request": {"number": 9, "id": 1}},
)
LABELED = event(
    "23",
    "PullRequestEvent",
    17,
    {"action": "labeled", "number": 9, "pull_request": {"number": 9}},
)
COMPARE = {"commits": [{"commit": {"message": "Refactor\n\nbody"}}]}
FULL_PULL = {
    "number": 9,
    "title": "Cache events",
    "html_url": "https://github.com/me/app/pull/9",
    "body": "Less calls",
}


@dataclass
class SlimApi:
    """Requested paths and editable answers of the slim fake API."""

    calls: list[str]
    answers: dict[str, object]


@pytest.fixture
def slim_api(monkeypatch: pytest.MonkeyPatch) -> SlimApi:
    """
    Fake API serving slim events (current Events API shape) plus compare / pulls

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        SlimApi: calls and answers
    """
    calls: list[str] = []
    answers: dict[str, object] = {
        "/user": {"login": "me"},
        "/repos/me/app/events": [LABELED, SLIM_PULL, NEW_BRANCH_PUSH, SLIM_PUSH],
        f"/repos/me/app/compare/{'a' * 40}...{'b' * 40}": COMPARE,
        "/repos/me/app/pulls/9": FULL_PULL,
    }

    def fake(url: str, token: str, timeout: float) -> object:
        """
        Answer one GET

        Args:
            url (str): API URL
            token (str): token
            timeout (float): timeout
        Returns:
            object: decoded JSON
        Raises:
            GitHubError: unknown path
        """
        del token, timeout
        path = url.removeprefix(API_ROOT).split("?")[0]
        calls.append(path)
        if path not in answers:
            raise GitHubError("not found, or the token has no access")
        return answers[path]

    monkeypatch.setattr(GitHubDataSource, "fetch", staticmethod(fake))
    return SlimApi(calls, answers)


def test_slim_events_are_completed_and_noise_dropped(
    settings: Settings, slim_api: SlimApi
) -> None:
    settings["activity_github_orgs"] = ""
    feed = GitHubDataSource().activities(WINDOW)
    assert [(item.id, item.title) for item in feed] == [
        ("github:22", "Merged PR #9: Cache events"),
        ("github:21", "Pushed to feat"),
        ("github:20", "Pushed 1 commit to main"),
    ]
    assert feed[0].link == "https://github.com/me/app/pull/9"
    assert feed[2].summary == "Refactor"
    assert not any("0000000" in path for path in slim_api.calls)


def test_failed_completion_keeps_the_event(
    settings: Settings, slim_api: SlimApi
) -> None:
    settings["activity_github_orgs"] = ""
    missing = event(
        "24",
        "PullRequestEvent",
        18,
        {"action": "opened", "number": 404, "pull_request": {"number": 404}},
    )
    slim_api.answers["/repos/me/app/events"] = [missing]
    feed = GitHubDataSource().activities(WINDOW)
    assert feed[0].title == "Opened PR #404"
    assert feed[0].link == "https://github.com/me/app/pull/404"


def commit(sha: str, hour: int, login: str, message: str) -> Event:
    """
    Build one Commits API item

    Args:
        sha (str): commit SHA
        hour (int): committer hour of the day
        login (str): author login
        message (str): commit message
    Returns:
        Event: commit
    """
    return {
        "sha": sha,
        "html_url": f"https://github.com/me/app/commit/{sha}",
        "author": {"login": login},
        "commit": {
            "message": message,
            "committer": {"date": f"2026-11-18T{hour:02d}:30:00Z"},
        },
    }


def test_commits_not_yet_pushed_as_events_are_added(
    settings: Settings, slim_api: SlimApi
) -> None:
    settings["activity_github_orgs"] = ""
    slim_api.answers["/repos/me/app/commits"] = [
        commit("e" * 40, 20, "ann", "Their change"),
        commit("d" * 40, 19, "me", "Fresh work\n\nbody"),
        commit("b" * 40, 13, "me", "Already in a push event"),
    ]
    feed = GitHubDataSource().activities(WINDOW)
    fresh = feed[0]
    assert fresh.id == f"github:commit-{'d' * 40}"
    assert fresh.kind == "push"
    assert (fresh.title, fresh.summary) == ("Fresh work", "Commit ddddddd")
    assert fresh.link == f"https://github.com/me/app/commit/{'d' * 40}"
    assert fresh.occurred_at == DAY.replace(hour=19, minute=30)
    ids = [item.id for item in feed]
    assert f"github:commit-{'b' * 40}" not in ids
    assert f"github:commit-{'e' * 40}" not in ids


def test_commits_follow_the_kind_filter(settings: Settings, slim_api: SlimApi) -> None:
    settings["activity_github_orgs"] = ""
    settings["activity_github_kinds"] = ["pull_request"]
    slim_api.answers["/repos/me/app/commits"] = [commit("d" * 40, 19, "me", "Work")]
    feed = GitHubDataSource().activities(WINDOW)
    assert all(item.kind == "pull_request" for item in feed)


def test_commits_listed_by_a_push_are_covered() -> None:
    push = event(
        "30",
        "PushEvent",
        9,
        {"head": "h" * 40, "commits": [{"sha": "c" * 40, "message": "Old"}]},
    )
    commits = [
        commit_event("me/app", commit(sha * 40, 9, "me", "x")) for sha in "hcz"
    ]
    kept = unpublished(commits, [push])
    assert [item["id"] for item in kept] == [f"commit-{'z' * 40}"]


def test_unreadable_commits_keep_the_events(
    settings: Settings, slim_api: SlimApi
) -> None:
    settings["activity_github_orgs"] = ""
    feed = GitHubDataSource().activities(WINDOW)
    assert "/repos/me/app/commits" in slim_api.calls
    assert [item.id for item in feed] == ["github:22", "github:21", "github:20"]

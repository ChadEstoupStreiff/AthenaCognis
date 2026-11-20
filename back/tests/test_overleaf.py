from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest

from controllers.activity.base import (
    DataSource,
    InvalidSettingError,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.overleaf_client import (
    DEFAULT_SERVER,
    OverleafError,
    cookie_header,
    normalize_server,
    parse_project,
)
from controllers.activity.overleaf_events import diff_text
from controllers.activity.overleaf_source import OverleafDataSource

DAY = datetime(2026, 11, 18)
WINDOW = TimeRange(DAY, DAY + timedelta(days=1))
PROJECT = "0123456789abcdef01234567"
OTHER_PROJECT = "fedcba9876543210fedcba98"
LINK = f"{DEFAULT_SERVER}/project/{PROJECT}"
COOKIE = "s%3Asecret"
Json = dict[str, object]
ME: Json = {"id": "u-me", "first_name": "Ada", "last_name": "Lovelace", "email": "a@x"}
ANN: Json = {"id": "u-ann", "first_name": "", "last_name": "", "email": "ann@x"}
Settings = dict[str, object]


def ms(hour: int, day: datetime = DAY) -> int:
    """
    Unix milliseconds of an hour of a day

    Args:
        hour (int): hour
        day (datetime): day (naive UTC)
    Returns:
        int: milliseconds
    """
    return int(day.replace(hour=hour, tzinfo=UTC).timestamp() * 1000)


def update(to_version: int, hour: int, users: list[Json], **extra: object) -> Json:
    """
    Build one history update

    Args:
        to_version (int): version reached
        hour (int): hour of the day
        users (list[Json]): authors
        extra (object): pathnames, project_ops, labels…
    Returns:
        Json: update
    """
    return {
        "fromV": to_version - 1,
        "toV": to_version,
        "meta": {"users": users, "start_ts": ms(hour), "end_ts": ms(hour)},
        "pathnames": [],
        "project_ops": [],
        "labels": [],
        **extra,
    }


MY_EDIT = update(
    5,
    10,
    [ME],
    pathnames=["main.tex", "intro.tex", "refs.bib", "abstract.tex"],
    labels=[
        {
            "id": "l1",
            "comment": "Submitted",
            "user_id": "u-me",
            "created_at": "2026-11-18T11:00:00.000Z",
        }
    ],
)
ANN_EDIT = update(4, 9, [ANN], project_ops=[{"add": {"pathname": "fig.png"}}])
OLD_EDIT = update(3, 9, [ME], pathnames=["main.tex"])
OLD_EDIT["meta"] = {"users": [ME], "end_ts": ms(9, DAY - timedelta(days=2))}
THREADS: Json = {
    "t1": {
        "messages": [
            {
                "id": "m1",
                "content": "Cite this",
                "timestamp": ms(12),
                "user": ANN,
                "user_id": "u-ann",
            },
            {
                "id": "m2",
                "content": "Done",
                "timestamp": ms(13),
                "user": ME,
                "user_id": "u-me",
            },
        ],
        "resolved": True,
        "resolved_at": "2026-11-18T14:00:00Z",
        "resolved_by_user": ME,
    }
}


@dataclass
class FakeOverleaf:
    """Overleaf answering from fixed data and recording calls."""

    is_up: bool = True
    calls: list[tuple[str, str]] = field(default_factory=list)

    def __call__(self, url: str, cookie: str, timeout: float) -> object:
        """
        Answer one GET

        Args:
            url (str): endpoint URL
            cookie (str): Cookie header
            timeout (float): timeout
        Returns:
            object: decoded JSON
        Raises:
            OverleafError: Overleaf down
        """
        del timeout
        path = url.removeprefix(DEFAULT_SERVER)
        self.calls.append((path, cookie))
        if not self.is_up:
            raise OverleafError("session expired (paste a fresh cookie)")
        answers: dict[str, object] = {
            "/user/projects": {
                "projects": [
                    {"_id": PROJECT, "name": "Thesis"},
                    {"_id": OTHER_PROJECT, "name": "Paper"},
                ]
            },
            "/user/personal_info": ME,
            f"/project/{PROJECT}/updates": {
                "updates": [MY_EDIT, ANN_EDIT, OLD_EDIT],
                "nextBeforeTimestamp": None,
            },
            f"/project/{PROJECT}/threads": THREADS,
            f"/project/{PROJECT}/diff": {
                "diff": [{"u": "same"}, {"i": "new line\n"}, {"d": "old line"}]
            },
        }
        return answers.get(path.split("?")[0], {})


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """
    Replace the data source settings with an editable dict, Overleaf added

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Settings: settings
    """
    values: Settings = {
        "activity_overleaf_added": True,
        "activity_overleaf_cookie": COOKIE,
        "activity_overleaf_projects": f"{LINK}\n",
    }
    monkeypatch.setattr(DataSource, "read_setting", staticmethod(values.get))
    return values


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeOverleaf:
    """
    Route Overleaf requests to a fake server

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        FakeOverleaf: server
    """
    fake = FakeOverleaf()
    monkeypatch.setattr(OverleafDataSource, "fetch", staticmethod(fake))
    return fake


def test_parse_project_links() -> None:
    for link in (
        LINK,
        f"{LINK}/",
        f"https://latex.example.org/project/{PROJECT}?x=1",
        PROJECT,
        f" {PROJECT.upper()} ",
    ):
        assert parse_project(link) == PROJECT
    for bad in ("https://www.overleaf.com/read/abc", "thesis", ""):
        with pytest.raises(OverleafError, match="not an Overleaf project link"):
            parse_project(bad)


def test_server_and_cookie() -> None:
    assert normalize_server("") == DEFAULT_SERVER
    assert normalize_server("latex.example.org/") == "https://latex.example.org"
    with pytest.raises(OverleafError):
        normalize_server("ftp://x")
    assert cookie_header("abc", DEFAULT_SERVER) == "overleaf_session2=abc"
    assert cookie_header("abc", "https://latex.example.org") == "overleaf.sid=abc"
    assert cookie_header("Cookie: a=1; b=2", DEFAULT_SERVER) == "a=1; b=2"
    assert cookie_header(" ", DEFAULT_SERVER) == ""


def test_diff_text_keeps_only_changes() -> None:
    payload = {"diff": [{"u": "same"}, {"i": "added\n\n"}, {"d": "gone"}]}
    assert diff_text(payload) == "+ added\n- gone"
    assert diff_text({"diff": {"binary": True}}) == ""


def test_feed_only_mine(settings: Settings, api: FakeOverleaf) -> None:
    source = OverleafDataSource()
    assert source.detail() == "1 project"
    feed = source.activities(WINDOW)
    assert [item.kind for item in feed] == ["comment", "comment", "version", "edit"]
    edit = feed[-1]
    assert edit.id == f"overleaf:{PROJECT}:v5"
    assert edit.title == "Edited main.tex, intro.tex, refs.bib (+1 more) in Thesis"
    assert edit.actors == ("Ada Lovelace",)
    assert edit.link == LINK
    assert edit.details == {
        "project": "Thesis",
        "files": "main.tex, intro.tex, refs.bib, abstract.tex",
    }
    assert feed[2].title == 'Labelled version "Submitted" in Thesis'
    assert [item.title for item in feed[:2]] == [
        "Resolved a comment in Thesis",
        "Replied to a comment in Thesis",
    ]
    assert all(cookie == f"overleaf_session2={COOKIE}" for _, cookie in api.calls)


def test_feed_everyone_and_kinds(settings: Settings, api: FakeOverleaf) -> None:
    settings["activity_overleaf_only_mine"] = False
    source = OverleafDataSource()
    feed = source.activities(WINDOW)
    assert len(feed) == 6
    ann_edit = feed[-1]
    assert ann_edit.title == "Changed files in Thesis"
    assert ann_edit.summary == "added fig.png"
    assert ann_edit.actors == ("ann@x",)
    settings["activity_overleaf_kinds"] = ["comment"]
    api.calls.clear()
    feed = OverleafDataSource().activities(WINDOW)
    assert {item.kind for item in feed} == {"comment"}
    assert len(feed) == 3
    assert not any("/updates" in path for path, _ in api.calls)


def test_text_changes_when_included(settings: Settings, api: FakeOverleaf) -> None:
    settings["activity_overleaf_include"] = ["changes"]
    settings["activity_overleaf_kinds"] = ["edit"]
    feed = OverleafDataSource().activities(WINDOW)
    changes = feed[0].details["changes"]
    assert changes.startswith("## main.tex\n+ new line\n- old line")
    diffs = [path for path, _ in api.calls if "/diff?" in path]
    assert "pathname=main.tex&from=4&to=5" in diffs[0]


def test_suggestions_skip_watched(settings: Settings, api: FakeOverleaf) -> None:
    fields = {item["key"]: item for item in OverleafDataSource().info().config}
    assert fields["activity_overleaf_projects"]["options"] == [
        {"value": f"{DEFAULT_SERVER}/project/{OTHER_PROJECT}", "label": "Paper"}
    ]
    assert fields["activity_overleaf_cookie"]["secret"] is True


def test_errors(settings: Settings, api: FakeOverleaf) -> None:
    source = OverleafDataSource()
    settings["activity_overleaf_projects"] = "https://www.overleaf.com/read/abc"
    with pytest.raises(InvalidSettingError):
        source.activities(WINDOW)
    settings["activity_overleaf_projects"] = LINK
    del settings["activity_overleaf_cookie"]
    with pytest.raises(InvalidSettingError, match="session cookie"):
        source.activities(WINDOW)
    fields = {item["key"]: item for item in source.info().config}
    assert fields["activity_overleaf_projects"]["options"] == []
    settings["activity_overleaf_cookie"] = COOKIE
    api.is_up = False
    with pytest.raises(SourceUnavailableError) as error:
        source.activities(WINDOW)
    assert "session expired" in str(error.value)
    assert COOKIE not in str(error.value)


def test_answers_are_cached(settings: Settings, api: FakeOverleaf) -> None:
    source = OverleafDataSource()
    source.activities(WINDOW)
    count = len(api.calls)
    source.activities(WINDOW)
    assert len(api.calls) == count

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import views.activity
from controllers.activity.activitywatch_client import (
    ActivityWatchError,
    check_url,
    host_header,
    parse_periods,
    period_text,
    time_slots,
    usage_query,
    validate_url,
)
from controllers.activity.activitywatch_source import (
    DEFAULT_URL,
    ActivityWatchDataSource,
)
from controllers.activity.base import DataSource, TimeRange
from controllers.activity.config import ConfigField, SourceConfig

START = datetime(2026, 11, 18, 9)
WINDOW = TimeRange(START, START + timedelta(hours=2))
HOST = "mac"
URL = "http://aw.local:5600"
BUCKETS = {
    f"aw-watcher-window_{HOST}": {"type": "currentwindow", "hostname": HOST},
    f"aw-watcher-afk_{HOST}": {"type": "afkstatus", "hostname": HOST},
    "aw-watcher-web-firefox": {"type": "web.tab.current", "hostname": "unknown"},
}
Settings = dict[str, object]
Event = dict[str, object]


def event(seconds: float, **data: str) -> Event:
    """
    Build one merged event as returned by the query API

    Args:
        seconds (float): duration
        **data (str): event data
    Returns:
        Event: JSON event
    """
    return {"timestamp": START.isoformat(), "duration": seconds, "data": data}


APP_PERIODS = [
    [
        event(1200, app="Code", title="a.py"),
        event(600, app="Code", title="b.py"),
        event(900, app="loginwindow", title=""),
        event(30, app="Slack", title="general"),
    ],
    [event(200, app="Firefox", title="Docs")],
]
WEB_PERIODS = [[event(300, **{"$domain": "github.com", "title": "PR 12"})], []]


@dataclass
class FakeServer:
    """ActivityWatch server answering from fixed data and recording calls."""

    is_up: bool = True
    buckets: dict[str, object] = field(default_factory=lambda: dict(BUCKETS))
    calls: list[tuple[str, object]] = field(default_factory=list)

    def __call__(self, url: str, body: bytes | None, timeout: float) -> object:
        """
        Answer one request

        Args:
            url (str): request URL
            body (bytes | None): JSON body, None for GET
            timeout (float): timeout
        Returns:
            object: decoded JSON answer
        Raises:
            ActivityWatchError: server down
        """
        del timeout
        payload = None if body is None else json.loads(body)
        self.calls.append((url, payload))
        if not self.is_up:
            raise ActivityWatchError("down")
        if url.endswith("/buckets/"):
            return self.buckets
        assert isinstance(payload, dict)
        return (
            WEB_PERIODS
            if "split_url_events" in "".join(payload["query"])
            else APP_PERIODS
        )


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """
    Replace the data source settings with an editable dict, ActivityWatch added

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Settings: settings
    """
    values: Settings = {
        "activity_activitywatch_added": True,
        # Every content field: these tests check them all.
        "activity_activitywatch_include": [
            item.key for item in ActivityWatchDataSource().content_fields()
        ],
        "activity_activitywatch_url": URL,
    }
    monkeypatch.setattr(DataSource, "read_setting", staticmethod(values.get))
    return values


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> FakeServer:
    """
    Route ActivityWatch requests to a fake server

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        FakeServer: server
    """
    fake = FakeServer()
    monkeypatch.setattr(ActivityWatchDataSource, "fetch", staticmethod(fake))
    return fake


def queries(server: FakeServer) -> list[dict[str, list[str]]]:
    """
    Bodies of the query requests sent

    Args:
        server (FakeServer): fake server
    Returns:
        list[dict[str, list[str]]]: query bodies
    """
    return [
        body
        for url, body in server.calls
        if url.endswith("/query/") and isinstance(body, dict)
    ]


def test_validate_url_accepts_http_only() -> None:
    assert validate_url(" http://h:5600/ ") == "http://h:5600"
    assert check_url("http://h:5600/api/0/query/") == "http://h:5600/api/0/query/"
    for bad in ("file:///etc/passwd", "localhost:5600", ""):
        with pytest.raises(ActivityWatchError):
            validate_url(bad)


def test_host_header_is_localhost_for_docker_alias_and_ips() -> None:
    assert host_header("http://host.docker.internal:5600") == "localhost:5600"
    assert host_header("http://192.168.1.4:5600/api/0/") == "localhost:5600"
    assert host_header("http://[::1]") == "localhost:80"
    assert host_header("https://aw.example.org") is None


def test_usage_query_filters_afk_and_groups_web_by_domain() -> None:
    lines = usage_query("win", "afk", is_web=False)
    assert lines[0] == 'events = flood(query_bucket("win"));'
    assert "events = filter_period_intersect(events, afk);" in lines
    assert lines[-1] == 'RETURN = merge_events_by_keys(events, ["app", "title"]);'
    web = usage_query("web", None, is_web=True)
    assert not any("afk" in line for line in web)
    assert web[-1] == 'RETURN = merge_events_by_keys(events, ["$domain", "title"]);'


def test_time_slots_and_periods() -> None:
    end = START + timedelta(minutes=90)
    slots = time_slots(START, end, timedelta(hours=1))
    assert slots == [
        (START, START + timedelta(hours=1)),
        (START + timedelta(hours=1), end),
    ]
    assert (
        period_text(slots[0]) == "2026-11-18T09:00:00+00:00/2026-11-18T10:00:00+00:00"
    )


def test_parse_periods_requires_one_result_per_period() -> None:
    with pytest.raises(ActivityWatchError):
        parse_periods([[]], 2)
    assert parse_periods([[{"duration": "x"}, event(5, app="A")]], 1)[0][0].data == {
        "app": "A"
    }


def test_feed_groups_usage_per_app_and_hour(
    settings: Settings, server: FakeServer
) -> None:
    feed = ActivityWatchDataSource().activities(WINDOW)
    assert [(item.kind, item.title) for item in feed] == [
        ("app", "Firefox"),
        ("app", "Code"),
        ("web", "github.com"),
    ]
    code = feed[1]
    assert code.occurred_at == START
    assert code.summary == "a.py (20 min); b.py (10 min)"
    assert code.details == {"duration": "30 min", "device": HOST}
    assert code.id == "activitywatch:mac:app:20261118T0900:Code"
    app_query, web_query = queries(server)
    assert len(app_query["timeperiods"]) == 2
    assert 'afk = flood(query_bucket("aw-watcher-afk_mac"));' in app_query["query"]
    assert 'afk = flood(query_bucket("aw-watcher-afk_mac"));' in web_query["query"]


def test_feed_settings(settings: Settings, server: FakeServer) -> None:
    source = ActivityWatchDataSource()
    settings.update(
        {
            "activity_activitywatch_share_titles": False,
            "activity_activitywatch_skip_short": True,
            "activity_activitywatch_web": False,
            "activity_activitywatch_skip_afk": False,
        }
    )
    feed = source.activities(WINDOW)
    assert [(item.title, item.summary) for item in feed] == [("Code", "")]
    assert len(queries(server)) == 1
    assert not any("afk" in line for line in queries(server)[0]["query"])
    server.buckets["aw-watcher-window_pc"] = {"type": "currentwindow", "hostname": "pc"}
    settings["activity_activitywatch_devices"] = ["pc"]
    assert [
        item.details["device"] for item in ActivityWatchDataSource().activities(WINDOW)
    ] == ["pc"]


def test_detail_and_config_from_cached_probe(
    settings: Settings, server: FakeServer
) -> None:
    source = ActivityWatchDataSource()
    assert source.detail() == "1 device"
    devices = source.info().config[1]
    assert devices["options"] == [{"value": HOST, "label": HOST}]
    assert len(server.calls) == 1
    assert source.state() == "active"


def test_unreachable_server(settings: Settings, server: FakeServer) -> None:
    server.is_up = False
    source = ActivityWatchDataSource()
    assert source.detail() == f"Not reachable at {URL}"
    assert source.info().config[1]["options"] == []
    app = FastAPI()
    app.include_router(views.activity.router)
    params = {"start": "2026-11-18T00:00:00", "end": "2026-11-19T00:00:00"}
    response = TestClient(app).get(
        "/activity/sources/activitywatch/feed", params=params
    )
    assert response.status_code == 502


def test_blank_url_falls_back_to_default(settings: Settings) -> None:
    settings["activity_activitywatch_url"] = "  "
    assert ActivityWatchDataSource().server_url() == DEFAULT_URL
    text_field = ConfigField("url", "URL", "", "text", DEFAULT_URL)
    config = SourceConfig([text_field], settings.get, "activity_activitywatch_")
    assert config.text("url") == DEFAULT_URL
    settings["activity_activitywatch_url"] = " http://x "
    assert config.text("url") == "http://x"

import json
import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import views.activity
from controllers.activity import common, settings_io
from controllers.activity.activitywatch_client import ActivityWatchError
from controllers.activity.activitywatch_source import ActivityWatchDataSource
from controllers.activity.generation import ACTIVITY_PROJECT
from controllers.activity.base import (
    MAX_INSTRUCTION_CHARS,
    Activity,
    DataSource,
    InvalidRangeError,
    TimeRange,
    trim,
)
from controllers.activity.library_source import LibraryDataSource
from controllers.activity.local_files_source import LocalFilesDataSource
from controllers.activity.mail_source import MailDataSource
from controllers.activity.registry import IMPLEMENTED, INCOMING, all_sources
from controllers.activity.research_source import ResearchDataSource
from controllers.activity.time_source import TimeDataSource
from controllers.activity.work_source import WorkDataSource
from controllers.mail import store
from db import (
    CalendarProject,
    CalendarRecord,
    CalendarTag,
    KanbanBoard,
    KanbanColumn,
    KanbanColumnTask,
    MailAccount,
    MailActivityFlag,
    MailMessage,
    MailSender,
    Project,
    Setting,
    StockPile,
    Summary,
    Tag,
    TagFile,
    Task,
    TaskProject,
)
from db.models import Base

DAY = datetime(2026, 11, 18)
SessionFactory = Callable[[], Session]
Settings = dict[str, object]


@pytest.fixture(autouse=True)
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """
    Replace the mail data source settings with an editable dict

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Settings: settings read by MailDataSource
    """
    values: Settings = {
        "activity_mail_added": True,
        "activity_mail_boxes": ["inbox"],
        "activity_mail_sent": True,
        "activity_mail_flagged": True,
        # Every content field: feed tests check them all (defaults checked on their own).
        **{
            f"activity_{source.key}_include": [
                item.key for item in source.content_fields()
            ]
            for source in IMPLEMENTED
        },
    }

    def clear(prefix: str) -> None:
        """
        Drop the settings starting with a prefix

        Args:
            prefix (str): key prefix
        Returns:
            None
        """
        for key in [key for key in values if key.startswith(prefix)]:
            del values[key]

    monkeypatch.setattr(DataSource, "read_setting", staticmethod(values.get))
    monkeypatch.setattr(DataSource, "write_setting", staticmethod(values.__setitem__))
    monkeypatch.setattr(DataSource, "clear_settings", staticmethod(clear))
    return values


@pytest.fixture(autouse=True)
def offline_activitywatch(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Make the ActivityWatch server unreachable (no network in tests)

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """

    def unreachable(url: str, body: bytes | None, timeout: float) -> object:
        """
        Fail like a server that is down

        Args:
            url (str): request URL
            body (bytes | None): request body
            timeout (float): timeout
        Returns:
            object: never returns
        Raises:
            ActivityWatchError: always
        """
        raise ActivityWatchError(f"{url} down")

    monkeypatch.setattr(ActivityWatchDataSource, "fetch", staticmethod(unreachable))


@pytest.fixture(autouse=True)
def library_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """
    Point the library, research and local file sources to an empty temporary folder

    Args:
        tmp_path (Path): pytest temporary directory
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Path: library root
    """
    monkeypatch.setattr(LibraryDataSource, "root", tmp_path)
    monkeypatch.setattr(ResearchDataSource, "root", tmp_path)
    monkeypatch.setattr(LocalFilesDataSource, "root", tmp_path)
    return tmp_path


@pytest.fixture
def factory(monkeypatch: pytest.MonkeyPatch) -> Iterator[SessionFactory]:
    """
    Point the mail store to an empty in-memory SQLite database

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Iterator[SessionFactory]: session factory
    """
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session_factory: SessionFactory = sessionmaker(bind=engine)
    monkeypatch.setattr(store, "get_db", session_factory)
    monkeypatch.setattr(common, "get_db", session_factory)
    yield session_factory
    engine.dispose()


def add_account(account_id: str = "acc") -> None:
    """
    Store one mail account

    Args:
        account_id (str): account id
    Returns:
        None
    """
    with store.session_scope() as session:
        session.add(
            MailAccount(
                id=account_id,
                label="Me",
                email=f"{account_id}@x.org",
                username="me@x.org",
                password="secret",
                imap_host="imap.x.org",
                imap_port=993,
                smtp_host="smtp.x.org",
                smtp_port=465,
            )
        )


def add_message(
    uid: int,
    moment: datetime,
    sender: str = "bob@x.org",
    mailbox: str = "inbox",
    flagged_at: datetime | None = None,
    account_id: str = "acc",
) -> None:
    """
    Store one message of the account

    Args:
        uid (int): server uid
        moment (datetime): date
        sender (str): sender address
        mailbox (str): "inbox" or "sent"
        flagged_at (datetime | None): moment flagged for the Activity feed
        account_id (str): account of the message
    Returns:
        None
    """
    with store.session_scope() as session:
        session.add(
            MailMessage(
                id=f"m{uid}",
                account_id=account_id,
                folder="INBOX",
                uid=uid,
                sender_email=sender,
                sender_name="Bob",
                recipients="alice@x.org, carol@x.org",
                subject=f"Subject {uid}",
                date=moment,
                snippet=f"Snippet {uid}",
                mailbox=mailbox,
            )
        )
        if flagged_at is not None:
            session.add(MailActivityFlag(message_id=f"m{uid}", flagged_at=flagged_at))


@pytest.fixture
def client(factory: SessionFactory) -> TestClient:
    """
    Test client of the activity router

    Args:
        factory (SessionFactory): database fixture
    Returns:
        TestClient: client
    """
    app = FastAPI()
    app.include_router(views.activity.router)
    return TestClient(app)


def test_time_range_rejects_reversed_and_too_long() -> None:
    with pytest.raises(InvalidRangeError):
        TimeRange(DAY, DAY)
    with pytest.raises(InvalidRangeError):
        TimeRange(DAY, DAY + timedelta(days=40))


def test_time_range_converts_aware_to_naive_utc() -> None:
    paris = timezone(timedelta(hours=1))
    window = TimeRange(
        DAY.replace(tzinfo=paris), (DAY + timedelta(days=1)).replace(tzinfo=paris)
    )
    assert window.start == DAY - timedelta(hours=1)
    assert window.start.tzinfo is None
    assert window.contains(datetime(2026, 11, 18, 12, tzinfo=UTC))


def test_ai_context_contains_every_fact() -> None:
    activity = Activity(
        id="a",
        source="mail",
        kind="received",
        occurred_at=DAY.replace(hour=9, minute=5),
        title="Budget",
        summary="Asks for Q4 numbers",
        actors=("Bob",),
        details={"needs_reply": "yes"},
    )
    assert (
        activity.ai_context()
        == "[09:05] mail/received — Budget (Bob): Asks for Q4 numbers; needs_reply=yes"
    )


def test_mail_source_inactive_without_account(factory: SessionFactory) -> None:
    source = MailDataSource()
    assert source.info().state == "inactive"
    assert source.activities(TimeRange(DAY, DAY + timedelta(days=1))) == []


def test_mail_source_feed_is_windowed_sorted_and_hides_blocked(
    factory: SessionFactory,
) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8))
    add_message(2, DAY.replace(hour=15), mailbox="sent")
    add_message(3, DAY - timedelta(hours=1))
    add_message(4, DAY.replace(hour=10), sender="spam@x.org")
    with store.session_scope() as session:
        session.add(MailSender(email="spam@x.org", flag="blocked"))
    feed = MailDataSource().activities(TimeRange(DAY, DAY + timedelta(days=1)))
    assert [item.id for item in feed] == ["mail:m2", "mail:m1"]
    assert feed[0].kind == "sent"
    assert feed[0].actors == ("alice@x.org", "carol@x.org")
    assert feed[1].actors == ("Bob",)
    assert feed[1].link == "/mail?open=m1"


def test_mail_source_boxes_filter_received_mail(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8))
    add_message(2, DAY.replace(hour=9), sender="news@x.org")
    with store.session_scope() as session:
        session.add(MailSender(email="news@x.org", flag="vip"))
    settings["activity_mail_boxes"] = ["priority", "bogus"]
    window = TimeRange(DAY, DAY + timedelta(days=1))
    assert [item.id for item in MailDataSource().activities(window)] == ["mail:m2"]


def test_mail_source_sent_and_flagged_toggles(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8), mailbox="sent")
    add_message(
        2, DAY.replace(hour=7), sender="spam@x.org", flagged_at=DAY.replace(hour=9)
    )
    with store.session_scope() as session:
        session.add(MailSender(email="spam@x.org", flag="blocked"))
    settings["activity_mail_boxes"] = []
    window = TimeRange(DAY, DAY + timedelta(days=1))
    feed = MailDataSource().activities(window)
    assert [item.id for item in feed] == ["mail:m2", "mail:m1"]
    assert feed[0].details["flagged_for_activity"] == "yes"
    settings["activity_mail_sent"] = False
    assert [item.id for item in MailDataSource().activities(window)] == ["mail:m2"]
    settings["activity_mail_flagged"] = False
    assert MailDataSource().activities(window) == []


def test_mail_flags_before_reset_time_count_for_the_day_before(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    settings["activity_mail_boxes"] = []
    settings["mail_activity_reset_time"] = "04:00"
    next_day = DAY + timedelta(days=1)
    add_message(1, DAY.replace(hour=8), flagged_at=next_day.replace(hour=3))
    add_message(2, DAY.replace(hour=8), flagged_at=next_day.replace(hour=5))
    add_message(3, DAY.replace(hour=8), flagged_at=DAY.replace(hour=3))
    today = TimeRange(DAY, next_day)
    tomorrow = TimeRange(next_day, next_day + timedelta(days=1))
    feed = MailDataSource().activities(today)
    assert [item.id for item in feed] == ["mail:m1"]
    assert feed[0].occurred_at == next_day - timedelta(seconds=1)
    assert [item.id for item in MailDataSource().activities(tomorrow)] == ["mail:m2"]


def test_mail_flag_of_listed_box_mail_marks_it_flagged(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8), flagged_at=DAY.replace(hour=10))
    feed = MailDataSource().activities(TimeRange(DAY, DAY + timedelta(days=1)))
    assert [(item.id, item.kind) for item in feed] == [("mail:m1", "received")]
    assert feed[0].occurred_at == DAY.replace(hour=8)
    assert feed[0].details["flagged_for_activity"] == "yes"


def test_mail_source_only_from_picked_accounts(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    add_account("work")
    add_message(1, DAY.replace(hour=8))
    add_message(2, DAY.replace(hour=9), account_id="work")
    window = TimeRange(DAY, DAY + timedelta(days=1))
    assert len(MailDataSource().activities(window)) == 2
    settings["activity_mail_accounts"] = ["work"]
    assert [item.id for item in MailDataSource().activities(window)] == ["mail:m2"]
    settings["activity_mail_accounts"] = ["removed"]
    assert len(MailDataSource().activities(window)) == 2


def test_source_instruction_is_trimmed_and_capped(
    factory: SessionFactory, settings: Settings
) -> None:
    source = MailDataSource()
    assert source.instruction_setting == "activity_mail_instruction"
    assert source.info().instruction == ""
    settings["activity_mail_instruction"] = "  Group by client.  "
    assert source.info().view()["instruction"] == "Group by client."
    settings["activity_mail_instruction"] = "x" * 5000
    assert len(source.instruction()) == MAX_INSTRUCTION_CHARS


def test_source_lifecycle_routes(client: TestClient, settings: Settings) -> None:
    assert client.post("/activity/sources/mail").status_code == 409
    add_account()
    settings.clear()
    assert client.get("/activity/sources").json()[0]["state"] == "available"
    assert (
        client.patch("/activity/sources/mail", json={"enabled": False}).status_code
        == 409
    )
    assert client.post("/activity/sources/mail").json()["state"] == "active"
    response = client.patch("/activity/sources/mail", json={"enabled": False})
    assert response.json()["state"] == "disabled"
    settings["activity_mail_instruction"] = "Group by client."
    assert client.delete("/activity/sources/mail").json()["state"] == "available"
    assert settings == {}
    assert client.post("/activity/sources/gitlab").status_code == 409


def test_disabled_source_has_empty_feed(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8))
    settings["activity_mail_enabled"] = False
    window = TimeRange(DAY, DAY + timedelta(days=1))
    assert MailDataSource().activities(window) == []


def test_sources_route_lists_mail_and_incoming(client: TestClient) -> None:
    add_account()
    sources = client.get("/activity/sources").json()
    assert sources[0]["key"] == "mail"
    assert sources[0]["state"] == "active"
    assert [source["key"] for source in sources[1:9]] == [
        "library",
        "work",
        "time",
        "research",
        "activitywatch",
        "agenda",
        "local_files",
        "github",
    ]
    assert {source["state"] for source in sources[1:9]} == {"available"}
    assert len(sources) == len(IMPLEMENTED) + len(INCOMING)
    assert {source["state"] for source in sources[9:]} == {"incoming"}
    boxes = sources[0]["config"][0]
    assert boxes["key"] == "activity_mail_boxes"
    assert boxes["default"] == ["priority"]
    assert len(all_sources()) == len(sources)


def test_feed_route_errors(client: TestClient) -> None:
    params = {"start": "2026-11-18T00:00:00", "end": "2026-11-19T00:00:00"}
    assert client.get("/activity/sources/nope/feed", params=params).status_code == 404
    assert client.get("/activity/sources/gitlab/feed", params=params).status_code == 409
    reversed_range = {"start": params["end"], "end": params["start"]}
    assert (
        client.get("/activity/sources/mail/feed", params=reversed_range).status_code
        == 400
    )


def test_feed_route_returns_activities(client: TestClient) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8))
    params = {"start": "2026-11-18T00:00:00Z", "end": "2026-11-19T00:00:00Z"}
    feed = client.get("/activity/sources/mail/feed", params=params).json()
    assert [item["id"] for item in feed] == ["mail:m1"]
    assert feed[0]["ai_context"].startswith("[08:00] mail/received — Subject 1")


def test_settings_io_writes_and_clears_by_prefix(
    factory: SessionFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings_io, "get_db", factory)
    settings_io.write_setting("activity_mail_added", True)
    settings_io.write_setting("activity_mail_added", False)
    settings_io.write_setting("activity_mailx_added", True)
    settings_io.write_setting("other", "kept")
    settings_io.clear_settings("activity_mail_")
    with factory() as session:
        keys = sorted(row.key for row in session.query(Setting))
    assert keys == ["activity_mailx_added", "other"]


WINDOW = TimeRange(DAY, DAY + timedelta(days=1))


def upload(root: Path, folder: str, name: str, hour: int) -> str:
    """
    Create a library file uploaded on DAY at a given hour (UTC)

    Args:
        root (Path): library root
        folder (str): upload folder
        name (str): file name
        hour (int): upload hour
    Returns:
        str: library path "/shared/<day>/<folder>/<name>"
    """
    file = root / f"{DAY:%Y-%m-%d}" / folder / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text("x")
    stamp = DAY.replace(hour=hour, tzinfo=UTC).timestamp()
    os.utime(file, (stamp, stamp))
    return f"/shared/{DAY:%Y-%m-%d}/{folder}/{name}"


def tag_as_research(factory: SessionFactory, path: str) -> None:
    """
    Tag a file with the research tag

    Args:
        factory (SessionFactory): database
        path (str): library path
    Returns:
        None
    """
    with factory() as session:
        session.add_all(
            [
                StockPile(key="sota_tag", value="paper"),
                Tag(name="paper", color="#000"),
                TagFile(file=path, tag="paper"),
            ]
        )
        session.commit()


def test_library_feed_uploads_summaries_and_filters(
    factory: SessionFactory, settings: Settings, library_root: Path
) -> None:
    report = upload(library_root, "uploads", "report.pdf", 9)
    paper = upload(library_root, "papers", "paper.pdf", 10)
    tag_as_research(factory, paper)
    with factory() as session:
        session.add(
            Summary(
                file=report,
                date=DAY.replace(hour=11),
                summary="Q4 numbers",
                keywords="budget",
            )
        )
        session.commit()
    settings["activity_library_added"] = True
    feed = LibraryDataSource().activities(WINDOW)
    assert [(item.kind, item.title) for item in feed] == [
        ("summary", "report.pdf"),
        ("uploaded", "report.pdf"),
    ]
    assert feed[0].summary == "Q4 numbers"
    assert feed[0].details["keywords"] == "budget"
    assert feed[1].occurred_at == DAY.replace(hour=9)
    assert feed[1].link == f"/f/{DAY:%Y-%m-%d}/uploads/report.pdf"
    settings["activity_library_skip_research"] = False
    settings["activity_library_folders"] = ["papers"]
    assert [item.title for item in LibraryDataSource().activities(WINDOW)] == [
        "paper.pdf"
    ]


def test_library_config_lists_folders_and_tags(
    factory: SessionFactory, library_root: Path
) -> None:
    upload(library_root, "uploads", "a.pdf", 9)
    with factory() as session:
        session.add(Tag(name="todo", color="#000"))
        session.commit()
    fields = {item.name: item for item in LibraryDataSource().config_fields()}
    assert [option.value for option in fields["folders"].options] == ["uploads"]
    assert [option.value for option in fields["tags"].options] == ["todo"]


def add_task(factory: SessionFactory, task_id: str, **moments: datetime) -> None:
    """
    Store one task

    Args:
        factory (SessionFactory): database
        task_id (str): task id
        **moments (datetime): completed / end_date / start_date
    Returns:
        None
    """
    with factory() as session:
        session.add(
            Task(
                id=task_id,
                title=f"Task {task_id}",
                description="Do it",
                priority=2,
                **moments,
            )
        )
        session.commit()


def test_work_feed_events_and_filters(
    factory: SessionFactory, settings: Settings
) -> None:
    add_task(
        factory, "t1", completed=DAY.replace(hour=11), end_date=DAY.replace(hour=17)
    )
    add_task(factory, "t2", start_date=DAY.replace(hour=8))
    add_task(factory, "t3", completed=DAY - timedelta(days=2))
    with factory() as session:
        session.add_all(
            [
                Project(name="Alpha", color="#000"),
                TaskProject(task_id="t2", project_name="Alpha"),
                KanbanBoard(id="b1", name="Sprint"),
                KanbanColumn(
                    id="c1", board_id="b1", name="Done", color="#0f0", position=1
                ),
                KanbanColumnTask(column_id="c1", task_id="t1"),
            ]
        )
        session.commit()
    settings["activity_work_added"] = True
    feed = WorkDataSource().activities(WINDOW)
    assert [(item.kind, item.title) for item in feed] == [
        ("due", "Task t1"),
        ("completed", "Task t1"),
    ]
    assert feed[0].details["done"] == "yes"
    assert feed[1].details["column"] == "Done"
    settings["activity_work_events"] = ["started", "completed"]
    settings["activity_work_projects"] = ["Alpha"]
    assert [item.id for item in WorkDataSource().activities(WINDOW)] == [
        "work:started:t2"
    ]
    settings["activity_work_projects"] = []
    settings["activity_work_boards"] = ["b1"]
    assert [item.id for item in WorkDataSource().activities(WINDOW)] == [
        "work:completed:t1"
    ]


def test_time_feed_filters_and_privacy(
    factory: SessionFactory, settings: Settings
) -> None:
    with factory() as session:
        session.add_all(
            [
                Project(name="Alpha", color="#000"),
                Project(name="Beta", color="#111"),
                Project(name=ACTIVITY_PROJECT, color="#222"),
                Tag(name="Deep", color="#333"),
                CalendarRecord(
                    id="r0",
                    project=ACTIVITY_PROJECT,
                    date=DAY.replace(hour=10),
                    time_spent=1,
                    title="Generated",
                ),
                CalendarRecord(
                    id="r1",
                    project="Alpha",
                    date=DAY,
                    start_time=DAY.replace(hour=9),
                    time_spent=1.5,
                    title="Review",
                    attendees="Ann, Bob",
                    location="Room 2",
                ),
                CalendarRecord(
                    id="r2",
                    project=None,
                    date=DAY.replace(hour=14),
                    time_spent=0.1,
                    title="Call",
                ),
                CalendarRecord(
                    id="r3",
                    project="Alpha",
                    date=DAY - timedelta(days=1),
                    time_spent=2,
                    title="Old",
                ),
            ]
        )
        session.flush()
        session.add_all(
            [
                CalendarProject(calendar_id="r0", project=ACTIVITY_PROJECT),
                CalendarProject(calendar_id="r1", project="Alpha"),
                CalendarProject(calendar_id="r1", project="Beta"),
                CalendarTag(calendar_id="r1", tag="Deep"),
                CalendarProject(calendar_id="r3", project="Alpha"),
            ]
        )
        session.commit()
    settings["activity_time_added"] = True
    feed = TimeDataSource().activities(WINDOW)
    assert [item.title for item in feed] == ["Call", "Review"]
    assert feed[1].actors == ("Ann", "Bob")
    assert feed[1].details == {
        "duration": "1.5 h",
        "project": "Alpha, Beta",
        "tags": "Deep",
        "location": "Room 2",
    }
    settings["activity_time_share_people"] = False
    settings["activity_time_skip_short"] = True
    feed = TimeDataSource().activities(WINDOW)
    assert [item.title for item in feed] == ["Review"]
    assert feed[0].actors == ()
    assert "location" not in feed[0].details
    settings["activity_time_skip_short"] = False
    settings["activity_time_projects"] = ["__none__"]
    assert [item.title for item in TimeDataSource().activities(WINDOW)] == ["Call"]
    settings["activity_time_projects"] = ["Beta"]
    assert [item.title for item in TimeDataSource().activities(WINDOW)] == ["Review"]


def test_research_feed_uses_paper_metadata(
    factory: SessionFactory, settings: Settings, library_root: Path
) -> None:
    paper = upload(library_root, "papers", "attention.pdf", 10)
    upload(library_root, "uploads", "other.pdf", 9)
    tag_as_research(factory, paper)
    info = {
        "title": "Attention Is All You Need",
        "authors": "Vaswani, Shazeer",
        "year": "2017",
        "validated": False,
    }
    with factory() as session:
        session.add_all(
            [
                StockPile(
                    key=f"sota_info_{DAY:%Y-%m-%d}_attention.pdf",
                    value=json.dumps(info),
                ),
                Summary(
                    file=paper,
                    date=DAY.replace(hour=12),
                    summary="Transformers",
                    keywords="",
                ),
            ]
        )
        session.commit()
    settings["activity_research_added"] = True
    source = ResearchDataSource()
    assert source.detail() == "1 paper"
    feed = source.activities(WINDOW)
    assert [(item.kind, item.title) for item in feed] == [
        ("summary", "Attention Is All You Need"),
        ("added", "Attention Is All You Need"),
    ]
    assert feed[0].actors == ("Vaswani", "Shazeer")
    assert feed[0].details == {"year": "2017", "validated": "no"}
    settings["activity_research_validated_only"] = True
    assert source.activities(WINDOW) == []


def test_regex_filters_apply_to_every_source(
    factory: SessionFactory, settings: Settings
) -> None:
    add_account()
    add_message(1, DAY.replace(hour=8))
    add_message(2, DAY.replace(hour=9), sender="eve@x.org")
    window = TimeRange(DAY, DAY + timedelta(days=1))
    source = MailDataSource()
    assert [field["key"] for field in source.info().config[-3:]] == [
        "activity_mail_include_regex",
        "activity_mail_exclude_regex",
        "activity_mail_regex_fields",
    ]
    settings["activity_mail_include_regex"] = "subject [12]"
    settings["activity_mail_exclude_regex"] = "SUBJECT 2"
    assert [item.id for item in source.activities(window)] == ["mail:m1"]
    settings["activity_mail_include_regex"] = ""
    settings["activity_mail_exclude_regex"] = "snippet 1"
    settings["activity_mail_regex_fields"] = ["title"]
    assert len(source.activities(window)) == 2
    settings["activity_mail_regex_fields"] = ["summary"]
    assert [item.id for item in source.activities(window)] == ["mail:m2"]


def test_invalid_regex_filter_is_a_bad_request(
    client: TestClient, settings: Settings
) -> None:
    add_account()
    settings["activity_mail_exclude_regex"] = "(unclosed"
    params = {"start": "2026-11-18T00:00:00", "end": "2026-11-19T00:00:00"}
    response = client.get("/activity/sources/mail/feed", params=params)
    assert response.status_code == 400
    assert "Invalid exclude regex" in response.json()["detail"]


def test_track_reports_each_step_like_tqdm() -> None:
    source = LocalFilesDataSource()
    seen: list[dict[str, object]] = []
    for _ in source.track(["a", "b", "c"], "Reading calendars", "calendars"):
        seen.append(source.progress().view())
    assert [(view["done"], view["total"], view["running"]) for view in seen] == [
        (0, 3, True),
        (1, 3, True),
        (2, 3, True),
    ]
    final = source.progress().view()
    assert (final["done"], final["running"], final["desc"], final["unit"]) == (
        3,
        False,
        "Reading calendars",
        "calendars",
    )


def test_track_stops_the_bar_on_failure() -> None:
    source = LocalFilesDataSource()
    with pytest.raises(RuntimeError):
        for _ in source.track([1, 2], "Querying", "buckets"):
            raise RuntimeError("down")
    assert source.progress().view()["running"] is False


def test_included_content_trims_activities(
    factory: SessionFactory, settings: Settings
) -> None:
    item = Activity(
        "id",
        "mail",
        "received",
        DAY,
        "Hello",
        "Body",
        ("Ann",),
        None,
        {"category": "person", "priority": "high", "unknown": "x"},
    )
    trimmed = trim(item, frozenset({"category"}))
    assert (trimmed.summary, trimmed.actors, trimmed.details) == (
        "",
        (),
        {"category": "person"},
    )
    assert trimmed.title == "Hello"
    defaults = MailDataSource().include_field().default
    assert "body" not in defaults and "priority" not in defaults
    assert {"summary", "actors", "category"} <= set(defaults)
    for source in IMPLEMENTED:
        assert source.include_field().name == "include"

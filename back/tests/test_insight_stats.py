from collections.abc import Iterator
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from controllers.activity.generation import ACTIVITY_PROJECT
from controllers.InsightStats import collect_insights
from db.models import (
    ActivityGenerationTask,
    Base,
    CalendarProject,
    CalendarRecord,
    MailAccount,
    MailDraft,
    MailMessage,
    MailOutgoing,
    MailSender,
    Project,
    TaskStateEnum,
)

NOW = datetime(2026, 11, 20, 9, 0, 0)
ACCOUNT_ID = "acc"


@pytest.fixture
def db() -> Iterator[Session]:
    """
    Open a session on an empty in-memory SQLite database

    Returns:
        Iterator[Session]: session
    """
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def message(uid: int, **fields: object) -> MailMessage:
    """
    Build a mail message of the test account

    Args:
        uid (int): server uid
        **fields (object): column overrides
    Returns:
        MailMessage: message
    """
    defaults: dict[str, object] = {
        "account_id": ACCOUNT_ID,
        "folder": "INBOX",
        "uid": uid,
        "sender_email": "a@b.c",
        "date": NOW,
    }
    return MailMessage(**{**defaults, **fields})


def record(record_id: str, hours: float) -> CalendarRecord:
    """
    Build a time entry

    Args:
        record_id (str): id
        hours (float): time spent
    Returns:
        CalendarRecord: entry
    """
    return CalendarRecord(id=record_id, date=NOW, time_spent=hours, title=record_id)


def test_empty_database_counts_zero(db: Session) -> None:
    """
    Report zero mail and activity counters on a fresh install

    Args:
        db (Session): session
    """
    stats = collect_insights(db)
    assert stats.mail.received == 0
    assert stats.mail.per_category == []
    assert stats.activity.generated_hours == 0.0
    assert stats.hours_per_project == []


def test_mail_counters_skip_trashed_and_purged(db: Session) -> None:
    """
    Count visible received and sent messages, senders, drafts and outbox

    Args:
        db (Session): session
    """
    db.add(
        MailAccount(
            id=ACCOUNT_ID,
            label="l",
            email="e",
            username="u",
            password="p",
            imap_host="h",
            imap_port=1,
            smtp_host="h",
            smtp_port=1,
        )
    )
    db.add_all(
        [
            message(1, is_read=True, category="person", preview_title="t"),
            message(2, needs_reply=True, is_flagged=True, category="newsletter"),
            message(3, category="person"),
            message(4, trashed_at=NOW),
            message(5, is_purged=True),
            message(6, mailbox="sent", folder="Sent", is_read=True),
            MailDraft(account_id=ACCOUNT_ID, updated=NOW),
            MailDraft(account_id=ACCOUNT_ID, updated=NOW, trashed_at=NOW),
            MailOutgoing(account_id=ACCOUNT_ID, created=NOW, state="failed"),
            MailSender(email="vip@x", flag="vip"),
            MailSender(email="spam@x", flag="blocked"),
        ]
    )
    db.commit()
    mail = collect_insights(db).mail
    assert (mail.accounts, mail.received, mail.unread, mail.sent) == (1, 3, 2, 1)
    assert (mail.needs_reply, mail.flagged, mail.previews) == (1, 1, 1)
    assert (mail.drafts, mail.outbox, mail.outbox_failed) == (1, 1, 1)
    assert (mail.vip_senders, mail.blocked_senders) == (1, 1)
    assert mail.per_category == [("person", 2.0), ("newsletter", 1.0)]


def test_activity_and_project_hours(db: Session) -> None:
    """
    Count generated days and entries and sum hours per project

    Args:
        db (Session): session
    """
    db.add_all(
        [
            Project(name=ACTIVITY_PROJECT, color="#000"),
            Project(name="Thesis", color="#111"),
            record("r1", 2.0),
            record("r2", 1.5),
            record("r3", 4.0),
            ActivityGenerationTask(
                file="daily/2026-11-19", added=NOW, state=TaskStateEnum.COMPLETED
            ),
            ActivityGenerationTask(
                file="daily/2026-11-19",
                added=datetime(2026, 11, 20, 10),
                state=TaskStateEnum.COMPLETED,
            ),
            ActivityGenerationTask(
                file="daily/2026-11-20", added=NOW, state=TaskStateEnum.FAILED
            ),
        ]
    )
    db.flush()
    db.add_all(
        [
            CalendarProject(calendar_id="r1", project=ACTIVITY_PROJECT),
            CalendarProject(calendar_id="r1", project="Thesis"),
            CalendarProject(calendar_id="r2", project=ACTIVITY_PROJECT),
            CalendarProject(calendar_id="r3", project="Thesis"),
        ]
    )
    db.commit()
    stats = collect_insights(db)
    assert stats.activity.generated_days == 1
    assert stats.activity.generated_entries == 2
    assert stats.activity.generated_hours == 3.5
    assert stats.hours_per_project == [("Thesis", 6.0), (ACTIVITY_PROJECT, 3.5)]

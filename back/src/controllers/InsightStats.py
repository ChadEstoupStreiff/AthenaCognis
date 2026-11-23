"""Counters of the home Insights tab for the newer features (mail, activity, AI coverage)."""

from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.query import RowReturningQuery

from controllers.activity.generation import ACTIVITY_PROJECT
from controllers.UsageStats import UsageStats, collect_usage, count_rows
from db.models import (
    ActivityGenerationTask,
    CalendarProject,
    CalendarRecord,
    DocumentTree,
    MailAccount,
    MailDraft,
    MailMessage,
    MailOutgoing,
    MailSender,
    TaskStateEnum,
)

INBOX_MAILBOX = "inbox"
SENT_MAILBOX = "sent"
VIP_FLAG = "vip"
BLOCKED_FLAG = "blocked"
FAILED_OUTGOING_STATE = "failed"

NamedTotal = tuple[str, float]


@dataclass(frozen=True)
class MailStats:
    """Mail client counters (trashed and purged messages excluded)."""

    accounts: int
    received: int
    unread: int
    needs_reply: int
    flagged: int
    sent: int
    drafts: int
    outbox: int
    outbox_failed: int
    previews: int
    vip_senders: int
    blocked_senders: int
    per_category: list[NamedTotal]


@dataclass(frozen=True)
class ActivityStats:
    """Activity generation counters."""

    generated_days: int
    generated_entries: int
    generated_hours: float


@dataclass(frozen=True)
class InsightStats:
    """Feature counters shown on the Insights tab."""

    usage: UsageStats
    document_trees: int
    mail: MailStats
    activity: ActivityStats
    hours_per_project: list[NamedTotal]


def scalar_int(query: RowReturningQuery[int]) -> int:
    """
    Read an integer aggregate (None counts as zero)

    Args:
        query (RowReturningQuery[int]): aggregate query
    Returns:
        int: value
    """
    return int(query.scalar() or 0)


def live_messages(db: Session, mailbox: str) -> RowReturningQuery[int]:
    """
    Count query over the visible messages of a logical mailbox

    Args:
        db (Session): database session
        mailbox (str): "inbox" or "sent"
    Returns:
        RowReturningQuery[int]: count query, filterable further
    """
    return db.query(func.count(MailMessage.id)).filter(
        MailMessage.mailbox == mailbox,
        MailMessage.trashed_at.is_(None),
        MailMessage.is_purged.is_(False),
    )


def count_senders(db: Session, flag: str) -> int:
    """
    Count senders carrying a flag

    Args:
        db (Session): database session
        flag (str): sender flag
    Returns:
        int: sender count
    """
    return scalar_int(
        db.query(func.count(MailSender.email)).filter(MailSender.flag == flag)
    )


def received_per_category(db: Session) -> list[NamedTotal]:
    """
    Count visible received messages per triage category, largest first

    Args:
        db (Session): database session
    Returns:
        List[NamedTotal]: (category, count) pairs
    """
    rows = (
        db.query(MailMessage.category, func.count(MailMessage.id))
        .filter(
            MailMessage.mailbox == INBOX_MAILBOX,
            MailMessage.trashed_at.is_(None),
            MailMessage.is_purged.is_(False),
        )
        .group_by(MailMessage.category)
        .all()
    )
    return sorted(
        ((str(name), float(count)) for name, count in rows), key=lambda row: -row[1]
    )


def collect_mail(db: Session) -> MailStats:
    """
    Collect the mail client counters

    Args:
        db (Session): database session
    Returns:
        MailStats: counters
    """
    received = live_messages(db, INBOX_MAILBOX)
    outbox_failed = db.query(func.count(MailOutgoing.id)).filter(
        MailOutgoing.state == FAILED_OUTGOING_STATE
    )
    return MailStats(
        accounts=count_rows(db, MailAccount),
        received=scalar_int(received),
        unread=scalar_int(received.filter(MailMessage.is_read.is_(False))),
        needs_reply=scalar_int(received.filter(MailMessage.needs_reply.is_(True))),
        flagged=scalar_int(received.filter(MailMessage.is_flagged.is_(True))),
        sent=scalar_int(live_messages(db, SENT_MAILBOX)),
        drafts=scalar_int(
            db.query(func.count(MailDraft.id)).filter(MailDraft.trashed_at.is_(None))
        ),
        outbox=count_rows(db, MailOutgoing),
        outbox_failed=scalar_int(outbox_failed),
        previews=scalar_int(received.filter(MailMessage.preview_title.isnot(None))),
        vip_senders=count_senders(db, VIP_FLAG),
        blocked_senders=count_senders(db, BLOCKED_FLAG),
        per_category=received_per_category(db),
    )


def collect_activity(db: Session) -> ActivityStats:
    """
    Collect the activity generation counters

    Args:
        db (Session): database session
    Returns:
        ActivityStats: counters
    """
    days = db.query(func.count(func.distinct(ActivityGenerationTask.file))).filter(
        ActivityGenerationTask.state == TaskStateEnum.COMPLETED
    )
    entry_count: int | None
    entry_hours: float | None
    entry_count, entry_hours = (
        db.query(func.count(CalendarRecord.id), func.sum(CalendarRecord.time_spent))
        .join(CalendarProject, CalendarProject.calendar_id == CalendarRecord.id)
        .filter(CalendarProject.project == ACTIVITY_PROJECT)
        .one()
    )
    return ActivityStats(
        generated_days=scalar_int(days),
        generated_entries=int(entry_count or 0),
        generated_hours=float(entry_hours or 0.0),
    )


def hours_per_project(db: Session) -> list[NamedTotal]:
    """
    Sum logged hours per project, largest first

    Args:
        db (Session): database session
    Returns:
        List[NamedTotal]: (project, hours) pairs
    """
    rows = (
        db.query(CalendarProject.project, func.sum(CalendarRecord.time_spent))
        .join(CalendarRecord, CalendarProject.calendar_id == CalendarRecord.id)
        .group_by(CalendarProject.project)
        .all()
    )
    return sorted(
        ((str(name), float(hours or 0.0)) for name, hours in rows),
        key=lambda row: -row[1],
    )


def collect_insights(db: Session) -> InsightStats:
    """
    Collect the feature counters of the Insights tab

    Args:
        db (Session): database session
    Returns:
        InsightStats: counters
    """
    return InsightStats(
        usage=collect_usage(db),
        document_trees=count_rows(db, DocumentTree),
        mail=collect_mail(db),
        activity=collect_activity(db),
        hours_per_project=hours_per_project(db),
    )

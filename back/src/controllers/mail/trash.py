"""Trash: deleted mail and drafts, restorable until purged after the retention period.

Deleting is local: the message stays on the mail server. A purged message keeps a
content-less tombstone row so the sync cursor (last UID, known remote ids) does not
fetch it again.
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from controllers.mail import drafts, store, uploads
from db import MailActivityFlag, MailDraft, MailMessage, MailSender
from views.settings import get_setting

RETENTION_SETTING = "mail_trash_retention_days"
DEFAULT_RETENTION_DAYS = 30
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650

JsonDict = dict[str, object]

logger = logging.getLogger(__name__)


def retention_days() -> int:
    """
    Days a deleted item stays in the Trash (setting, default when invalid)

    Returns:
        int: days
    """
    value = get_setting(RETENTION_SETTING)
    if isinstance(value, bool) or not isinstance(value, int):
        return DEFAULT_RETENTION_DAYS
    if not MIN_RETENTION_DAYS <= value <= MAX_RETENTION_DAYS:
        return DEFAULT_RETENTION_DAYS
    return value


def _live_message(session: Session, message_id: str) -> MailMessage:
    """
    Load a message that is not in the Trash

    Args:
        session (Session): session
        message_id (str): id
    Returns:
        MailMessage: row
    Raises:
        NotFoundError: when missing or already trashed
    """
    message = store.get_message(session, message_id)
    if message.trashed_at is not None:
        raise store.NotFoundError(f"Mail {message_id} is already in the Trash.")
    return message


def _trashed_message(session: Session, message_id: str) -> MailMessage:
    """
    Load a message of the Trash (purged ones are gone)

    Args:
        session (Session): session
        message_id (str): id
    Returns:
        MailMessage: row
    Raises:
        NotFoundError: when not in the Trash
    """
    message = store.get_message(session, message_id)
    if message.trashed_at is None or message.is_purged:
        raise store.NotFoundError(f"Mail {message_id} not found in Trash.")
    return message


def trash_message(message_id: str) -> None:
    """
    Move a message to the Trash

    Args:
        message_id (str): id
    Raises:
        NotFoundError: when missing or already trashed
    """
    with store.session_scope() as session:
        _live_message(session, message_id).trashed_at = store.utc_now()


def restore_message(message_id: str) -> None:
    """
    Put a trashed message back in its views

    Args:
        message_id (str): id
    Raises:
        NotFoundError: when not in the Trash
    """
    with store.session_scope() as session:
        _trashed_message(session, message_id).trashed_at = None


def _trashed_messages(session: Session) -> list[JsonDict]:
    """
    Serialize the messages of the Trash, last deleted first

    Args:
        session (Session): session
    Returns:
        list[JsonDict]: message summaries
    """
    priority = store.priority_column()
    statement = (
        select(MailMessage, MailSender.flag, priority, store.contact_column())
        .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
        .where(MailMessage.trashed_at.isnot(None), MailMessage.is_purged.is_(False))
        .order_by(MailMessage.trashed_at.desc())
    )
    return [
        store.message_summary(message, flag or store.DEFAULT_FLAG, level, contact_id)
        for message, flag, level, contact_id in session.execute(statement)
    ]


def _trashed_drafts(session: Session) -> list[JsonDict]:
    """
    Serialize the drafts of the Trash, last deleted first

    Args:
        session (Session): session
    Returns:
        list[JsonDict]: drafts
    """
    rows = session.scalars(
        select(MailDraft)
        .where(MailDraft.trashed_at.isnot(None))
        .order_by(MailDraft.trashed_at.desc())
    )
    return [drafts.draft_view(draft) for draft in rows]


def list_trash(days: int) -> JsonDict:
    """
    List the Trash: deleted messages and drafts with the retention period

    Args:
        days (int): retention period in days
    Returns:
        JsonDict: retention_days, messages, drafts
    """
    with store.session_scope() as session:
        return {
            "retention_days": days,
            "messages": _trashed_messages(session),
            "drafts": _trashed_drafts(session),
        }


def _tombstone(message: MailMessage) -> None:
    """
    Strip a trashed message down to what the sync cursor needs

    Args:
        message (MailMessage): row
    """
    message.is_purged = True
    message.is_pinned = False
    message.subject = ""
    message.snippet = ""
    message.body_text = ""
    message.body_html = None
    message.attachments = "[]"
    message.summary = None
    message.suggested_action = None
    message.preview_title = None
    message.preview_text = None


def purge_before(cutoff: datetime | None) -> int:
    """
    Remove for good the Trash items deleted before cutoff

    Args:
        cutoff (datetime | None): deletion time limit, None = whole Trash
    Returns:
        int: items purged (messages and drafts)
    """
    with store.session_scope() as session:
        message_query = select(MailMessage).where(
            MailMessage.trashed_at.isnot(None), MailMessage.is_purged.is_(False)
        )
        draft_query = select(MailDraft).where(MailDraft.trashed_at.isnot(None))
        if cutoff is not None:
            message_query = message_query.where(MailMessage.trashed_at < cutoff)
            draft_query = draft_query.where(MailDraft.trashed_at < cutoff)
        messages = list(session.scalars(message_query))
        for message in messages:
            _tombstone(message)
        ids = [message.id for message in messages]
        if ids:
            session.execute(
                delete(MailActivityFlag).where(MailActivityFlag.message_id.in_(ids))
            )
        old_drafts = list(session.scalars(draft_query))
        for draft in old_drafts:
            session.delete(draft)
    purged = len(messages) + len(old_drafts)
    if purged:
        logger.info("MAIL >> Purged %d items from the Trash", purged)
    return purged


def purge_expired(days: int) -> int:
    """
    Remove for good the Trash items older than the retention period

    Args:
        days (int): retention period in days
    Returns:
        int: items purged
    """
    purged = purge_before(store.utc_now() - timedelta(days=days))
    uploads.purge_orphans()
    return purged

"""Daily "flagged for Activity" marks of mail, with a configurable day reset time."""

import logging
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from db import MailActivityFlag, MailMessage

RESET_SETTING = "mail_activity_reset_time"
DEFAULT_RESET = "04:00"
DEFAULT_RESET_OFFSET = timedelta(hours=4)
RESET_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

logger = logging.getLogger(__name__)


def parse_reset(value: object) -> timedelta:
    """
    Convert an "HH:MM" reset time to its offset from midnight (invalid → default)

    Args:
        value (object): stored setting
    Returns:
        timedelta: offset from midnight
    """
    match = RESET_PATTERN.match(value) if isinstance(value, str) else None
    if match is None:
        logger.warning("Invalid %s %r, using %s", RESET_SETTING, value, DEFAULT_RESET)
        return DEFAULT_RESET_OFFSET
    return timedelta(hours=int(match.group(1)), minutes=int(match.group(2)))


def flag(session: Session, message: MailMessage, now: datetime | None = None) -> None:
    """
    Flag a message for the current activity day and keep the flag in history

    Args:
        session (Session): open session
        message (MailMessage): message
        now (Optional[datetime]): naive UTC flag moment (default: current time)
    Returns:
        None
    """
    moment = now or datetime.now(UTC).replace(tzinfo=None)
    session.add(MailActivityFlag(message_id=message.id, flagged_at=moment))
    message.activity_flagged_at = moment


def unflag(session: Session, message: MailMessage) -> None:
    """
    Remove the current flag of a message (earlier days stay in history)

    Args:
        session (Session): open session
        message (MailMessage): message
    Returns:
        None
    """
    if message.activity_flagged_at is None:
        return
    session.execute(
        delete(MailActivityFlag).where(
            MailActivityFlag.message_id == message.id,
            MailActivityFlag.flagged_at == message.activity_flagged_at,
        )
    )
    message.activity_flagged_at = None

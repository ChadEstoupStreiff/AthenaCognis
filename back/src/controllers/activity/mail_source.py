"""Mail data source: mail of chosen boxes, sent mail and mail flagged for activity."""

import json
from dataclasses import replace
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.sql.elements import ColumnElement

from controllers.activity.base import (
    PEOPLE_CONTENT,
    SUMMARY_CONTENT,
    Activity,
    ContentField,
    DataSource,
    SourceDescriptor,
    TimeRange,
)
from controllers.activity.common import excerpt
from controllers.activity.config import ConfigField, SourceConfig, options_of
from controllers.mail import activity_flags, store
from db import MailAccount, MailActivityFlag, MailMessage, MailSender

HIDDEN_PRIORITY = "hidden"
MAX_MESSAGES = 1000
MAX_RECIPIENTS = 5
MAX_ATTACHMENTS = 5
MAIL_CONTENT = [
    ContentField(SUMMARY_CONTENT, "AI preview or snippet"),
    ContentField(PEOPLE_CONTENT, "Sender / recipients"),
    ContentField("category", "Category"),
    ContentField("priority", "Priority", default=False),
    ContentField("read", "Read state", default=False),
    ContentField("needs_reply", "Needs reply"),
    ContentField("suggested_action", "Suggested action"),
    ContentField("flagged_for_activity", "Flagged for activity", default=False),
    ContentField("cc", "Cc", default=False),
    ContentField("attachments", "Attachment names", default=False),
    ContentField("body", "Body excerpt", default=False),
]
# Flag made after midnight but before the reset time: shown at the end of its day.
LAST_MOMENT_OFFSET = timedelta(seconds=1)
# Received-mail boxes the feed can pull from ("sent" has its own toggle).
BOX_OPTIONS = options_of(
    [
        ("priority", "Priority"),
        ("pinned", "Pinned"),
        ("inbox", "People"),
        ("unread", "Unread"),
        ("needs_reply", "Needs reply"),
        ("flagged", "Flagged"),
        ("others", "Others"),
        ("all", "All"),
    ]
)


def selection(
    config: SourceConfig, priority: ColumnElement[str]
) -> list[ColumnElement[bool]]:
    """
    Conditions selecting the box and sent mail of the feed (any of them matches)

    Args:
        config (SourceConfig): mail source settings
        priority (ColumnElement[str]): priority expression
    Returns:
        list[ColumnElement[bool]]: conditions, empty when nothing is selected
    """
    visible = priority != HIDDEN_PRIORITY
    conditions: list[ColumnElement[bool]] = [
        visible & store.view_filter(box, priority) for box in config.choices("boxes")
    ]
    if config.flag("sent"):
        conditions.append(MailMessage.mailbox == "sent")
    return conditions


MAIL_DESCRIPTOR = SourceDescriptor(
    key="mail",
    label="Mail",
    icon="pi pi-envelope",
    description="Received and sent mail of the connected accounts.",
)


def _recipients(raw: str) -> tuple[str, ...]:
    """
    Split a stored recipient list, keeping the first few

    Args:
        raw (str): comma-separated recipients
    Returns:
        tuple[str, ...]: recipients
    """
    parts = [part.strip() for part in raw.split(",") if part.strip()]
    return tuple(parts[:MAX_RECIPIENTS])


def _summary(message: MailMessage) -> str:
    """
    Best short description of a message: AI preview, AI summary, then snippet

    Args:
        message (MailMessage): message
    Returns:
        str: summary text
    """
    return message.preview_text or message.summary or message.snippet


def _details(message: MailMessage, priority: str) -> dict[str, str]:
    """
    Facts useful to a day summary

    Args:
        message (MailMessage): message
        priority (str): computed priority
    Returns:
        dict[str, str]: details
    """
    details = {"category": message.category, "priority": priority}
    if message.mailbox == "inbox":
        details["read"] = "yes" if message.is_read else "no"
    if message.needs_reply is not None:
        details["needs_reply"] = "yes" if message.needs_reply else "no"
    if message.suggested_action:
        details["suggested_action"] = message.suggested_action
    if message.cc:
        details["cc"] = message.cc
    names = attachment_names(message.attachments)
    if names:
        details["attachments"] = ", ".join(names[:MAX_ATTACHMENTS])
    if message.body_text:
        details["body"] = excerpt(message.body_text)
    return details


def attachment_names(raw: str) -> list[str]:
    """
    Names of the attachments of a message

    Args:
        raw (str): JSON list stored on the message
    Returns:
        list[str]: names, empty when malformed
    """
    try:
        names = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [str(name) for name in names] if isinstance(names, list) else []


def to_activity(message: MailMessage, priority: str) -> Activity:
    """
    Convert a message to an activity at its date

    Args:
        message (MailMessage): message
        priority (str): computed priority
    Returns:
        Activity: normalized activity
    """
    is_sent = message.mailbox == "sent"
    sender = message.sender_name or message.sender_email
    return Activity(
        id=f"mail:{message.id}",
        source=MAIL_DESCRIPTOR.key,
        kind="sent" if is_sent else "received",
        occurred_at=message.date,
        title=message.preview_title or message.subject or "(no subject)",
        summary=_summary(message),
        actors=_recipients(message.recipients) if is_sent else (sender,),
        link=f"/mail?open={message.id}",
        details=_details(message, priority),
    )


def flagged_activity(
    message: MailMessage, priority: str, flagged_at: datetime, window: TimeRange
) -> Activity:
    """
    Convert a message flagged for activity to an activity at its flag moment

    Args:
        message (MailMessage): message
        priority (str): computed priority
        flagged_at (datetime): flag moment
        window (TimeRange): feed window (flags past its end land on its last moment)
    Returns:
        Activity: normalized activity marked as flagged
    """
    activity = to_activity(message, priority)
    details = {**activity.details, "flagged_for_activity": "yes"}
    occurred_at = min(flagged_at, window.end - LAST_MOMENT_OFFSET)
    return replace(activity, occurred_at=occurred_at, details=details)


def flag_window(window: TimeRange, reset: timedelta) -> tuple[datetime, datetime]:
    """
    Shift a window of local days to the flag moments of those activity days

    A flag before the reset time counts for the day before: day D gathers flags
    from D + reset to D + 1 day + reset.

    Args:
        window (TimeRange): window starting and ending at local midnight
        reset (timedelta): activity reset time, offset from midnight
    Returns:
        tuple[datetime, datetime]: [start, end) of flag moments
    """
    return window.start + reset, window.end + reset


def account_filter(config: SourceConfig) -> list[ColumnElement[bool]]:
    """
    Condition keeping the chosen accounts (none chosen: every account)

    Args:
        config (SourceConfig): mail source settings
    Returns:
        list[ColumnElement[bool]]: zero or one condition on MailMessage
    """
    accounts = config.choices("accounts")
    return [MailMessage.account_id.in_(accounts)] if accounts else []


class MailDataSource(DataSource):
    """Messages stored by the mail client, picked by the mail activity settings."""

    descriptor = MAIL_DESCRIPTOR
    setup_link = "/settings#mail-accounts"

    def _account_count(self) -> int:
        """
        Count the connected accounts

        Returns:
            int: number of accounts
        """
        with store.session_scope() as session:
            return session.scalar(select(func.count()).select_from(MailAccount)) or 0

    def is_configured(self) -> bool:
        """
        Tell whether at least one account is connected

        Returns:
            bool: True with one account or more
        """
        return self._account_count() > 0

    def detail(self) -> str:
        """
        Describe the connected accounts

        Returns:
            str: "N account(s)" or setup hint
        """
        count = self._account_count()
        if count == 0:
            return "No account connected"
        return f"{count} account{'s' if count > 1 else ''}"

    def content_fields(self) -> list[ContentField]:
        """
        Content a mail activity can carry

        Returns:
            list[ContentField]: summary, people, mail facts and optional body
        """
        return MAIL_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare boxes, accounts, sent and flagged settings

        Returns:
            list[ConfigField]: fields
        """
        with store.session_scope() as session:
            accounts = [(row.id, row.email) for row in store.list_accounts(session)]
        return [
            ConfigField(
                "boxes",
                "Auto add mail from box",
                "Received mail of these boxes joins the feed.",
                "multiselect",
                ("priority",),
                BOX_OPTIONS,
                "No box",
            ),
            ConfigField(
                "accounts",
                "Only from account",
                "None picked: every account.",
                "multiselect",
                (),
                options_of(accounts),
                "All accounts",
            ),
            ConfigField(
                "sent",
                "Auto add sent and reply mail",
                "Mail you send, new messages and replies.",
                "toggle",
                True,
            ),
            ConfigField(
                "flagged",
                "Auto add mail flagged for activity",
                "Mail marked with the yellow lightning in Mail, whatever its box.",
                "toggle",
                True,
            ),
        ]

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the box, sent and flagged messages of the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per message, newest first
        """
        config = self.config()
        found = {item.id: item for item in self._box_activities(config, window)}
        if config.flag("flagged"):
            for item in self._flagged_activities(config, window):
                listed = found.get(item.id)
                found[item.id] = (
                    item if listed is None else replace(listed, details=item.details)
                )
        ordered = sorted(
            found.values(), key=lambda item: item.occurred_at, reverse=True
        )
        return ordered[:MAX_MESSAGES]

    def _box_activities(
        self, config: SourceConfig, window: TimeRange
    ) -> list[Activity]:
        """
        Read the messages of the chosen boxes and the sent mail dated in the window

        Args:
            config (SourceConfig): mail source settings
            window (TimeRange): time window
        Returns:
            list[Activity]: activities at the message date
        """
        priority = store.priority_column()
        conditions = selection(config, priority)
        if not conditions:
            return []
        statement = (
            select(MailMessage, priority)
            .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
            .where(MailMessage.date >= window.start, MailMessage.date < window.end)
            .where(store.not_trashed())
            .where(or_(*conditions))
            .order_by(MailMessage.date.desc())
            .where(*account_filter(config))
            .limit(MAX_MESSAGES)
        )
        with store.session_scope() as session:
            return [
                to_activity(message, level)
                for message, level in session.execute(statement)
            ]

    def _flagged_activities(
        self, config: SourceConfig, window: TimeRange
    ) -> list[Activity]:
        """
        Read the messages flagged for an activity day of the window

        Args:
            config (SourceConfig): mail source settings
            window (TimeRange): time window (local days)
        Returns:
            list[Activity]: activities at the flag moment
        """
        reset = activity_flags.parse_reset(
            self.read_setting(activity_flags.RESET_SETTING)
            or activity_flags.DEFAULT_RESET
        )
        start, end = flag_window(window, reset)
        priority = store.priority_column()
        statement = (
            select(MailMessage, priority, MailActivityFlag.flagged_at)
            .join(MailActivityFlag, MailActivityFlag.message_id == MailMessage.id)
            .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
            .where(MailActivityFlag.flagged_at >= start, store.not_trashed())
            .where(MailActivityFlag.flagged_at < end)
            .order_by(MailActivityFlag.flagged_at.desc())
            .where(*account_filter(config))
            .limit(MAX_MESSAGES)
        )
        with store.session_scope() as session:
            return [
                flagged_activity(message, level, flagged_at, window)
                for message, level, flagged_at in session.execute(statement)
            ]

"""Database access of the mail client: accounts, messages, senders, priorities."""

import json
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal, get_args

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from controllers.mail.imap_client import ServerLogin
from controllers.mail.parser import ParsedMail
from controllers.mail.transport import AccountLink, FetchCursor
from db import Contact, MailAccount, MailMessage, MailSender, get_db

DEFAULT_FLAG = "normal"
MUTED_FLAG = "muted"
MAX_PAGE = 200

MailView = Literal[
    "sent",
    "pinned",
    "inbox",
    "priority",
    "others",
    "unread",
    "flagged",
    "needs_reply",
    "blocked",
    "all",
]
MAIL_VIEWS: tuple[str, ...] = get_args(MailView)
JsonDict = dict[str, object]


class NotFoundError(Exception):
    """Requested row does not exist."""


@contextmanager
def session_scope() -> Iterator[Session]:
    """
    Open a session, commit on success, roll back on error

    Returns:
        Iterator[Session]: session
    """
    session = get_db()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def utc_now() -> datetime:
    """
    Current naive UTC time (DB convention)

    Returns:
        datetime: now
    """
    return datetime.now(UTC).replace(tzinfo=None)


# MARK: accounts


@dataclass(frozen=True)
class AccountInput:
    """Editable account fields (empty password = keep the stored one)."""

    label: str
    protocol: str
    color: str
    signature: str
    email: str
    username: str
    password: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int


def account_view(account: MailAccount) -> JsonDict:
    """
    Serialize an account without its password

    Args:
        account (MailAccount): account
    Returns:
        JsonDict: account
    """
    return {
        "id": account.id,
        "label": account.label,
        "protocol": account.protocol,
        "color": account.color,
        "signature": account.signature or "",
        "email": account.email,
        "username": account.username,
        "imap_host": account.imap_host,
        "imap_port": account.imap_port,
        "smtp_host": account.smtp_host,
        "smtp_port": account.smtp_port,
        "last_sync": account.last_sync.isoformat() if account.last_sync else None,
        "last_error": account.last_error,
    }


def get_account(session: Session, account_id: str) -> MailAccount:
    """
    Load one account

    Args:
        session (Session): session
        account_id (str): account id
    Returns:
        MailAccount: account
    Raises:
        NotFoundError: when the account does not exist
    """
    account = session.get(MailAccount, account_id)
    if account is None:
        raise NotFoundError(f"Mail account {account_id} not found.")
    return account


def list_accounts(session: Session) -> list[MailAccount]:
    """
    List accounts by label

    Args:
        session (Session): session
    Returns:
        list[MailAccount]: accounts
    """
    return list(session.scalars(select(MailAccount).order_by(MailAccount.label)))


def apply_account(account: MailAccount, data: AccountInput) -> None:
    """
    Copy edited fields onto an account (password only when given)

    Args:
        account (MailAccount): account
        data (AccountInput): fields
    """
    account.label = data.label.strip() or data.email
    account.protocol = data.protocol
    account.color = data.color.lower()
    account.signature = data.signature.strip("\n")
    account.email = data.email.strip().lower()
    account.username = data.username.strip() or data.email.strip()
    account.imap_host = data.imap_host.strip()
    account.imap_port = data.imap_port
    # Exchange reads and sends through the same EWS endpoint.
    is_ews = data.protocol == "ews"
    account.smtp_host = account.imap_host if is_ews else data.smtp_host.strip()
    account.smtp_port = account.imap_port if is_ews else data.smtp_port
    if data.password:
        account.password = data.password


def link_of(account: MailAccount) -> AccountLink:
    """
    Server access of an account, usable after the session closes

    Args:
        account (MailAccount): account
    Returns:
        AccountLink: protocol, address and servers
    """
    return AccountLink(
        protocol=account.protocol,
        email=account.email,
        incoming=ServerLogin(
            account.imap_host, account.imap_port, account.username, account.password
        ),
        outgoing=ServerLogin(
            account.smtp_host, account.smtp_port, account.username, account.password
        ),
    )


# MARK: senders


def muted_senders(session: Session, emails: list[str]) -> set[str]:
    """
    Pick the muted addresses among emails

    Args:
        session (Session): session
        emails (list[str]): addresses
    Returns:
        set[str]: muted addresses
    """
    query = select(MailSender.email).where(
        MailSender.email.in_(emails), MailSender.flag == MUTED_FLAG
    )
    return set(session.scalars(query))


def ensure_senders(session: Session, mails: list[ParsedMail]) -> None:
    """
    Create a sender row for every new address (keeps the latest display name)

    Args:
        session (Session): session
        mails (list[ParsedMail]): messages
    """
    names = {mail.sender_email: mail.sender_name for mail in mails}
    known = {
        sender.email: sender
        for sender in session.scalars(
            select(MailSender).where(MailSender.email.in_(names))
        )
    }
    for email, name in names.items():
        if email in known:
            known[email].name = name or known[email].name
        else:
            session.add(MailSender(email=email, name=name, flag=DEFAULT_FLAG, note=""))


def get_sender(session: Session, email: str) -> MailSender:
    """
    Load a sender, creating a default row when unknown

    Args:
        session (Session): session
        email (str): address
    Returns:
        MailSender: sender
    """
    address = email.strip().lower()
    sender = session.get(MailSender, address)
    if sender is None:
        sender = MailSender(email=address, name="", flag=DEFAULT_FLAG, note="")
        session.add(sender)
    return sender


def contact_id_of(session: Session, sender: MailSender) -> str | None:
    """
    Contact of a sender: explicit link, else a contact with the same email

    Args:
        session (Session): session
        sender (MailSender): sender
    Returns:
        str | None: contact id
    """
    if sender.contact_id:
        return sender.contact_id
    match = session.scalars(
        select(Contact.id).where(func.lower(Contact.email) == sender.email).limit(1)
    ).first()
    return None if match is None else str(match)


def sender_view(session: Session, sender: MailSender) -> JsonDict:
    """
    Serialize a sender with its contact and message stats

    Args:
        session (Session): session
        sender (MailSender): sender
    Returns:
        JsonDict: sender
    """
    total, unread, last = session.execute(
        select(
            func.count(MailMessage.id),
            func.sum(case((MailMessage.is_read.is_(False), 1), else_=0)),
            func.max(MailMessage.date),
        ).where(MailMessage.sender_email == sender.email, not_trashed())
    ).one()
    return {
        "email": sender.email,
        "name": sender.name,
        "flag": sender.flag,
        "note": sender.note,
        "contact_id": contact_id_of(session, sender),
        "message_count": int(total or 0),
        "unread_count": int(unread or 0),
        "last_date": last.isoformat() if last else None,
    }


def list_senders(
    session: Session, flag: str | None, search: str | None
) -> list[JsonDict]:
    """
    List senders, most recent correspondents first

    Args:
        session (Session): session
        flag (str | None): only this flag
        search (str | None): text in name or email
    Returns:
        list[JsonDict]: senders
    """
    last_date = (
        select(func.max(MailMessage.date))
        .where(MailMessage.sender_email == MailSender.email)
        .scalar_subquery()
    )
    query = (
        select(MailSender).order_by(last_date.desc(), MailSender.email).limit(MAX_PAGE)
    )
    if flag:
        query = query.where(MailSender.flag == flag)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                MailSender.email.like(pattern),
                func.lower(MailSender.name).like(pattern),
            )
        )
    return [sender_view(session, sender) for sender in session.scalars(query)]


def update_sender(
    session: Session, email: str, flag: str | None, note: str | None
) -> MailSender:
    """
    Change how a sender is treated

    Args:
        session (Session): session
        email (str): address
        flag (str | None): new flag, None = unchanged
        note (str | None): new note, None = unchanged
    Returns:
        MailSender: sender
    """
    sender = get_sender(session, email)
    if flag is not None:
        sender.flag = flag
    if note is not None:
        sender.note = note
    return sender


def link_contact(session: Session, email: str) -> str:
    """
    Link a sender to its contact, creating the contact when none matches

    Args:
        session (Session): session
        email (str): address
    Returns:
        str: contact id
    """
    sender = get_sender(session, email)
    contact_id = contact_id_of(session, sender)
    if contact_id is None:
        contact = Contact(
            name=sender.name or sender.email, email=sender.email, notes=sender.note
        )
        session.add(contact)
        session.flush()
        contact_id = str(contact.id)
    sender.contact_id = contact_id
    return contact_id


# MARK: messages


def last_uid(session: Session, account_id: str, mailbox: str) -> int:
    """
    Highest stored UID of a mailbox

    Args:
        session (Session): session
        account_id (str): account id
        mailbox (str): inbox or sent
    Returns:
        int: UID, 0 when the mailbox is empty
    """
    query = select(func.max(MailMessage.uid)).where(
        MailMessage.account_id == account_id, MailMessage.mailbox == mailbox
    )
    return int(session.scalar(query) or 0)


def fetch_cursor(session: Session, account_id: str, mailbox: str) -> FetchCursor:
    """
    Describe what is stored for a mailbox (last UID, last date, known remote ids)

    Args:
        session (Session): session
        account_id (str): account id
        mailbox (str): inbox or sent
    Returns:
        FetchCursor: cursor
    """
    in_folder = (MailMessage.account_id == account_id, MailMessage.mailbox == mailbox)
    last_date = session.scalar(select(func.max(MailMessage.date)).where(*in_folder))
    remote_ids = select(MailMessage.remote_id).where(
        *in_folder, MailMessage.remote_id.isnot(None)
    )
    known = {remote_id for remote_id in session.scalars(remote_ids) if remote_id}
    return FetchCursor(last_uid(session, account_id, mailbox), last_date, known)


def save_messages(
    session: Session, account_id: str, mails: list[ParsedMail]
) -> list[str]:
    """
    Store new messages (muted senders arrive read; sent mail is read, no sender row)

    Args:
        session (Session): session
        account_id (str): account id
        mails (list[ParsedMail]): parsed messages
    Returns:
        list[str]: ids of the stored messages
    """
    received = [mail for mail in mails if mail.mailbox == "inbox"]
    if received:
        ensure_senders(session, received)
    muted = muted_senders(session, [mail.sender_email for mail in received])
    rows = [
        _message_row(
            account_id, mail, mail.mailbox == "sent" or mail.sender_email in muted
        )
        for mail in mails
    ]
    session.add_all(rows)
    session.flush()
    return [row.id for row in rows]


def _message_row(account_id: str, mail: ParsedMail, force_read: bool) -> MailMessage:
    """
    Build the row of a parsed message

    Args:
        account_id (str): account id
        mail (ParsedMail): message
        force_read (bool): store as read whatever the server says
    Returns:
        MailMessage: row
    """
    return MailMessage(
        account_id=account_id,
        folder=mail.folder,
        uid=mail.uid,
        mailbox=mail.mailbox,
        remote_id=mail.remote_id,
        message_id=mail.message_id,
        thread_refs=mail.thread_refs,
        sender_email=mail.sender_email,
        sender_name=mail.sender_name,
        recipients=mail.recipients,
        cc=mail.cc,
        subject=mail.subject,
        date=mail.date,
        snippet=mail.snippet,
        body_text=mail.body_text,
        body_html=mail.body_html,
        attachments=json.dumps(mail.attachments),
        category=mail.category,
        is_read=mail.is_read or force_read,
        is_flagged=mail.is_flagged,
    )


def priority_column() -> ColumnElement[str]:
    """
    SQL priority of a message: blocked → hidden, VIP → high, muted or automated → low,
    known contact → high, anyone else → normal (needs an outer join on MailSender)

    Returns:
        ColumnElement[str]: priority expression
    """
    flag = func.coalesce(MailSender.flag, DEFAULT_FLAG)
    contact_emails = select(func.lower(Contact.email)).where(Contact.email.isnot(None))
    is_contact = or_(
        MailSender.contact_id.isnot(None), MailMessage.sender_email.in_(contact_emails)
    )
    return case(
        (flag == "blocked", "hidden"),
        (flag == "vip", "high"),
        (or_(flag == MUTED_FLAG, MailMessage.category != "person"), "low"),
        (is_contact, "high"),
        else_="normal",
    )


def not_trashed() -> ColumnElement[bool]:
    """
    Condition excluding messages in the Trash (and purged ones)

    Returns:
        ColumnElement[bool]: condition
    """
    return MailMessage.trashed_at.is_(None)


def view_filter(view: str, priority: ColumnElement[str]) -> ColumnElement[bool]:
    """
    Condition selecting the messages of a mailbox view (never trashed ones)

    Args:
        view (str): view name (MAIL_VIEWS)
        priority (ColumnElement[str]): priority expression
    Returns:
        ColumnElement[bool]: condition
    """
    return not_trashed() & _view_condition(view, priority)


def _view_condition(view: str, priority: ColumnElement[str]) -> ColumnElement[bool]:
    """
    Condition of a mailbox view, Trash aside

    Args:
        view (str): view name (MAIL_VIEWS)
        priority (ColumnElement[str]): priority expression
    Returns:
        ColumnElement[bool]: condition
    """
    if view == "sent":
        return MailMessage.mailbox == "sent"
    if view == "pinned":
        return MailMessage.is_pinned.is_(True)
    visible = priority != "hidden"
    filters: dict[str, ColumnElement[bool]] = {
        "inbox": priority.in_(("high", "normal")),
        "priority": priority == "high",
        "others": priority == "low",
        "unread": visible & MailMessage.is_read.is_(False),
        "flagged": MailMessage.is_flagged.is_(True),
        "needs_reply": visible & MailMessage.needs_reply.is_(True),
        "blocked": priority == "hidden",
    }
    received = MailMessage.mailbox == "inbox"
    return received & filters.get(view, visible)


def ids_in_views(
    session: Session, message_ids: list[str], views: list[str]
) -> list[str]:
    """
    Keep the messages that belong to at least one of the views

    Args:
        session (Session): session
        message_ids (list[str]): candidate ids
        views (list[str]): mailbox views
    Returns:
        list[str]: matching ids (empty when no view is given)
    """
    if not message_ids or not views:
        return []
    priority = priority_column()
    statement = (
        select(MailMessage.id)
        .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
        .where(
            MailMessage.id.in_(message_ids),
            or_(*(view_filter(view, priority) for view in views)),
        )
    )
    return list(session.scalars(statement))


@dataclass(frozen=True)
class MessageFilters:
    """Search filters of the message list (None = not filtered)."""

    from_text: str | None = None
    to_text: str | None = None
    since: date | None = None
    until: date | None = None
    category: str | None = None
    unread: bool | None = None
    attachments: bool | None = None


def filter_conditions(filters: MessageFilters) -> list[ColumnElement[bool]]:
    """
    SQL conditions of the search filters

    Args:
        filters (MessageFilters): filters
    Returns:
        list[ColumnElement[bool]]: conditions, all required
    """
    conditions: list[ColumnElement[bool]] = []
    if filters.from_text and filters.from_text.strip():
        pattern = f"%{filters.from_text.strip()}%"
        conditions.append(
            or_(
                MailMessage.sender_email.like(pattern),
                MailMessage.sender_name.like(pattern),
            )
        )
    if filters.to_text and filters.to_text.strip():
        pattern = f"%{filters.to_text.strip()}%"
        conditions.append(
            or_(MailMessage.recipients.like(pattern), MailMessage.cc.like(pattern))
        )
    if filters.since is not None:
        conditions.append(MailMessage.date >= datetime.combine(filters.since, time.min))
    if filters.until is not None:
        day_after = datetime.combine(filters.until, time.min) + timedelta(days=1)
        conditions.append(MailMessage.date < day_after)
    if filters.category:
        conditions.append(MailMessage.category == filters.category)
    if filters.unread is not None:
        conditions.append(MailMessage.is_read.is_(not filters.unread))
    if filters.attachments is not None:
        has_files = MailMessage.attachments.notin_(("", "[]"))
        conditions.append(has_files if filters.attachments else ~has_files)
    return conditions


@dataclass(frozen=True)
class MessageQuery:
    """Filters of the message list."""

    view: str = "inbox"
    account_ids: tuple[str, ...] = ()
    search: str | None = None
    sender: str | None = None
    limit: int = 50
    offset: int = 0
    contact_id: str | None = None
    filters: MessageFilters = field(default_factory=MessageFilters)


def account_filter(account_ids: Sequence[str]) -> ColumnElement[bool]:
    """
    Condition matching mail of the given accounts

    Args:
        account_ids (Sequence[str]): account ids
    Returns:
        ColumnElement[bool]: condition
    """
    return MailMessage.account_id.in_(account_ids)


def _contact_filter(contact_id: str) -> ColumnElement[bool]:
    """
    Condition matching mail from a People contact: its email or senders linked to it

    Args:
        contact_id (str): contact id
    Returns:
        ColumnElement[bool]: condition
    """
    contact_email = select(func.lower(Contact.email)).where(
        Contact.id == contact_id, Contact.email.isnot(None)
    )
    linked = select(MailSender.email).where(MailSender.contact_id == contact_id)
    return or_(
        MailMessage.sender_email.in_(contact_email),
        MailMessage.sender_email.in_(linked),
    )


def _search_filter(search: str) -> ColumnElement[bool]:
    """
    Condition matching text in subject, sender or preview

    Args:
        search (str): text
    Returns:
        ColumnElement[bool]: condition
    """
    pattern = f"%{search.strip()}%"
    return or_(
        MailMessage.subject.like(pattern),
        MailMessage.sender_email.like(pattern),
        MailMessage.sender_name.like(pattern),
        MailMessage.snippet.like(pattern),
    )


def list_messages(session: Session, query: MessageQuery) -> list[JsonDict]:
    """
    List messages of a view, newest first

    Args:
        session (Session): session
        query (MessageQuery): filters
    Returns:
        list[JsonDict]: message summaries with sender flag and priority
    """
    priority = priority_column()
    statement = (
        select(
            MailMessage,
            func.coalesce(MailSender.flag, DEFAULT_FLAG),
            priority,
            contact_column(),
        )
        .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
        .where(view_filter(query.view, priority))
        .order_by(MailMessage.is_pinned.desc(), MailMessage.date.desc())
        .limit(min(query.limit, MAX_PAGE))
        .offset(query.offset)
    )
    if query.account_ids:
        statement = statement.where(account_filter(query.account_ids))
    if query.sender:
        statement = statement.where(MailMessage.sender_email == query.sender.lower())
    if query.contact_id:
        statement = statement.where(_contact_filter(query.contact_id))
    if query.search and query.search.strip():
        statement = statement.where(_search_filter(query.search))
    statement = statement.where(*filter_conditions(query.filters))
    return [
        message_summary(message, flag, level, contact_id)
        for message, flag, level, contact_id in session.execute(statement)
    ]


def contact_column() -> ColumnElement[str | None]:
    """
    SQL People contact of a message sender: explicit link, else same email
    (needs an outer join on MailSender)

    Returns:
        ColumnElement[str | None]: contact id or NULL
    """
    same_email = (
        select(Contact.id)
        .where(func.lower(Contact.email) == MailMessage.sender_email)
        .limit(1)
        .scalar_subquery()
    )
    return func.coalesce(MailSender.contact_id, same_email)


def message_summary(
    message: MailMessage, flag: str, priority: str, contact_id: str | None
) -> JsonDict:
    """
    Serialize the list fields of a message

    Args:
        message (MailMessage): message
        flag (str): sender flag
        priority (str): computed priority
        contact_id (str | None): People contact of the sender
    Returns:
        JsonDict: summary
    """
    return {
        "id": message.id,
        "contact_id": contact_id,
        "account_id": message.account_id,
        "sender_email": message.sender_email,
        "sender_name": message.sender_name,
        "subject": message.subject,
        "date": message.date.isoformat(),
        "snippet": message.snippet,
        "category": message.category,
        "is_read": message.is_read,
        "is_flagged": message.is_flagged,
        "is_pinned": message.is_pinned,
        "activity_flagged_at": (
            message.activity_flagged_at.isoformat()
            if message.activity_flagged_at
            else None
        ),
        "mailbox": message.mailbox,
        "trashed_at": (message.trashed_at.isoformat() if message.trashed_at else None),
        "recipients": message.recipients,
        "has_attachments": message.attachments not in ("", "[]"),
        "summary": message.summary,
        "needs_reply": message.needs_reply,
        "suggested_action": message.suggested_action,
        "preview_title": message.preview_title,
        "preview_text": message.preview_text,
        "sender_flag": flag,
        "priority": priority,
    }


def get_message(session: Session, message_id: str) -> MailMessage:
    """
    Load one message

    Args:
        session (Session): session
        message_id (str): message id
    Returns:
        MailMessage: message
    Raises:
        NotFoundError: when the message does not exist
    """
    message = session.get(MailMessage, message_id)
    if message is None:
        raise NotFoundError(f"Mail {message_id} not found.")
    return message


def message_detail(session: Session, message: MailMessage) -> JsonDict:
    """
    Serialize a message with bodies, attachments and its sender

    Args:
        session (Session): session
        message (MailMessage): message
    Returns:
        JsonDict: message
    """
    sender = sender_view(session, get_sender(session, message.sender_email))
    priority = session.execute(
        select(priority_column())
        .select_from(MailMessage)
        .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
        .where(MailMessage.id == message.id)
    ).scalar_one()
    return {
        **message_summary(
            message, str(sender["flag"]), priority, _optional_str(sender["contact_id"])
        ),
        "cc": message.cc,
        "body_text": message.body_text,
        "body_html": message.body_html,
        "attachments": json.loads(message.attachments or "[]"),
        "message_id": message.message_id,
        "sender": sender,
    }


def _optional_str(value: object) -> str | None:
    """
    Narrow a JSON value to an optional string

    Args:
        value (object): value
    Returns:
        str | None: the string, None otherwise
    """
    return value if isinstance(value, str) else None


def view_counts(session: Session, account_ids: Sequence[str]) -> dict[str, int]:
    """
    Count unread messages per view (flagged, needs_reply, blocked, pinned count all)

    Args:
        session (Session): session
        account_ids (Sequence[str]): only these accounts, empty for all
    Returns:
        dict[str, int]: view → count
    """
    priority = priority_column()
    counts: dict[str, int] = {}
    for view in MAIL_VIEWS:
        statement = (
            select(func.count(MailMessage.id))
            .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
            .where(view_filter(view, priority))
        )
        if view not in ("flagged", "needs_reply", "blocked", "pinned"):
            statement = statement.where(MailMessage.is_read.is_(False))
        if account_ids:
            statement = statement.where(account_filter(account_ids))
        counts[view] = int(session.scalar(statement) or 0)
    return counts

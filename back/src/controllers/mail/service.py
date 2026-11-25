"""Mail client use cases: sync, read state, AI triage, digest, reply and send."""

import logging
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.mail import activity_flags, store, uploads
from controllers.mail.assistant import (
    MAX_DIGEST_MAILS,
    LlmCall,
    MailBrief,
    draft_reply,
    summarize,
    write_digest,
)
from controllers.mail.compose import compose_body
from controllers.mail.imap_client import FetchedMail, MailServerError
from controllers.mail.parser import (
    Attachment,
    AttachmentNotFoundError,
    ParsedMail,
    extract_attachment,
    extract_attachments,
    extract_bodies,
    parse_message,
    parse_raw_message,
)
from controllers.mail.smtp_client import OutgoingMail
from controllers.mail.transport import (
    AccountLink,
    MailboxKind,
    MailFlag,
    MessageRef,
    transport_for,
)
from db import MailAccount, MailMessage, MailSender

SYNC_LIMIT = 200
NewMailHook = Callable[[list[str]], None]
# Set at startup (MailManager.queue_new_mail): new received mail ids after each sync.
NEW_MAIL_HOOK: NewMailHook | None = None
MAILBOXES: tuple[MailboxKind, ...] = ("inbox", "sent")

logger = logging.getLogger(__name__)
# One lock per account: background auto fetch and manual sync never overlap.
_SYNC_LOCKS: dict[str, threading.Lock] = {}
_SYNC_LOCKS_GUARD = threading.Lock()


@dataclass(frozen=True)
class SyncResult:
    """Outcome of one account sync."""

    account_id: str
    fetched: int
    error: str | None = None


def _parse_all(
    fetched: list[FetchedMail], folder: str, mailbox: MailboxKind
) -> list[ParsedMail]:
    """
    Parse fetched messages, skipping unreadable ones

    Args:
        fetched (list[FetchedMail]): raw messages
        folder (str): server folder
        mailbox (MailboxKind): inbox or sent
    Returns:
        list[ParsedMail]: parsed messages with server flags
    """
    parsed: list[ParsedMail] = []
    for item in fetched:
        try:
            mail = parse_message(item.raw, item.uid, folder)
        except (ValueError, LookupError, IndexError, TypeError) as error:
            logger.warning("Skipping unreadable mail UID %s: %s", item.uid, error)
            continue
        mail.is_read, mail.is_flagged = item.is_read, item.is_flagged
        mail.remote_id = item.remote_id
        mail.mailbox = mailbox
        parsed.append(mail)
    return parsed


def _account_lock(account_id: str) -> threading.Lock:
    """
    Get the sync lock of an account

    Args:
        account_id (str): account id
    Returns:
        threading.Lock: lock shared by every sync of that account
    """
    with _SYNC_LOCKS_GUARD:
        return _SYNC_LOCKS.setdefault(account_id, threading.Lock())


def sync_account(account_id: str, limit: int = SYNC_LIMIT) -> SyncResult:
    """
    Fetch the new received and sent messages of an account

    Args:
        account_id (str): account id
        limit (int): maximum messages fetched per mailbox
    Returns:
        SyncResult: messages stored, or the server error
    Raises:
        NotFoundError: when the account does not exist
    """
    with _account_lock(account_id):
        return _sync_account_locked(account_id, limit)


def _sync_account_locked(account_id: str, limit: int) -> SyncResult:
    """
    Fetch the new messages of an account (caller holds its sync lock)

    Args:
        account_id (str): account id
        limit (int): maximum messages fetched per mailbox
    Returns:
        SyncResult: messages stored, or the server error
    Raises:
        NotFoundError: when the account does not exist
    """
    with store.session_scope() as session:
        link = store.link_of(store.get_account(session, account_id))
    try:
        count = sum(
            _sync_mailbox(link, account_id, mailbox, limit) for mailbox in MAILBOXES
        )
    except MailServerError as error:
        _record_sync(account_id, str(error))
        return SyncResult(account_id, 0, str(error))
    _record_sync(account_id, None)
    return SyncResult(account_id, count)


def _sync_mailbox(
    link: AccountLink, account_id: str, mailbox: MailboxKind, limit: int
) -> int:
    """
    Fetch and store the new messages of one mailbox

    Args:
        link (AccountLink): account servers
        account_id (str): account id
        mailbox (MailboxKind): inbox or sent
        limit (int): maximum messages fetched
    Returns:
        int: messages stored
    Raises:
        MailServerError: when the server fails
    """
    with store.session_scope() as session:
        cursor = store.fetch_cursor(session, account_id, mailbox)
    batch = transport_for(link).fetch(mailbox, cursor, limit)
    parsed = _parse_all(batch.mails, batch.folder, mailbox)
    with store.session_scope() as session:
        ids = store.save_messages(session, account_id, parsed)
    if mailbox == "inbox" and NEW_MAIL_HOOK is not None:
        NEW_MAIL_HOOK(ids)
    return len(ids)


def _record_sync(account_id: str, error: str | None) -> None:
    """
    Store the time and error of the last sync

    Args:
        account_id (str): account id
        error (str | None): error, None on success
    """
    with store.session_scope() as session:
        account = store.get_account(session, account_id)
        account.last_sync = store.utc_now()
        account.last_error = error


def sync_all() -> list[SyncResult]:
    """
    Sync every account

    Returns:
        list[SyncResult]: one result per account
    """
    with store.session_scope() as session:
        ids = [account.id for account in store.list_accounts(session)]
    return [sync_account(account_id) for account_id in ids]


def set_state(
    message_id: str, is_read: bool | None, is_flagged: bool | None
) -> str | None:
    """
    Mark a message read/unread or flagged/unflagged, locally then on the server

    Args:
        message_id (str): message id
        is_read (bool | None): new read state, None = unchanged
        is_flagged (bool | None): new flag state, None = unchanged
    Returns:
        str | None: server error (the local change is kept), None on success
    """
    with store.session_scope() as session:
        message = store.get_message(session, message_id)
        link = store.link_of(store.get_account(session, message.account_id))
        ref = ref_of(message)
        changes: list[tuple[MailFlag, bool]] = []
        if is_read is not None and message.is_read != is_read:
            message.is_read = is_read
            changes.append(("read", is_read))
        if is_flagged is not None and message.is_flagged != is_flagged:
            message.is_flagged = is_flagged
            changes.append(("flagged", is_flagged))
    transport = transport_for(link)
    errors = [transport.set_flag(ref, flag, enabled) for flag, enabled in changes]
    return next((error for error in errors if error), None)


def set_pinned(message_id: str, is_pinned: bool) -> None:
    """
    Pin or unpin a message (kept in AthenaCognis, pinned mail lists first)

    Args:
        message_id (str): message id
        is_pinned (bool): new state
    Raises:
        NotFoundError: when the message does not exist
    """
    with store.session_scope() as session:
        store.get_message(session, message_id).is_pinned = is_pinned


def set_activity(message_id: str, is_activity: bool) -> None:
    """
    Flag or unflag a message for today's Activity feed (kept in AthenaCognis)

    Args:
        message_id (str): message id
        is_activity (bool): new state
    Raises:
        NotFoundError: when the message does not exist
    """
    with store.session_scope() as session:
        message = store.get_message(session, message_id)
        if is_activity:
            activity_flags.flag(session, message)
        else:
            activity_flags.unflag(session, message)


def ref_of(message: MailMessage) -> MessageRef:
    """
    Server address of a stored message

    Args:
        message (MailMessage): message
    Returns:
        MessageRef: folder, UID and remote id
    """
    return MessageRef(message.folder, message.uid, message.remote_id)


def attachment(message_id: str, index: int) -> Attachment:
    """
    Download one attachment of a stored message from its server

    Args:
        message_id (str): message id
        index (int): attachment position in the message's attachment list
    Returns:
        Attachment: file name, MIME type and content
    Raises:
        NotFoundError: when the message or the attachment does not exist
        MailServerError: when the server fails
    """
    raw = _fetch_raw(message_id)
    try:
        return extract_attachment(raw, index)
    except AttachmentNotFoundError as error:
        raise store.NotFoundError(str(error)) from error


def repair_inline_images(message_id: str) -> bool:
    """
    Embed the cid: images of a message stored before they were embedded at sync

    Args:
        message_id (str): message id
    Returns:
        bool: True when the stored HTML body was updated
    Raises:
        NotFoundError: when the message does not exist
        MailServerError: when the server fails
    """
    with store.session_scope() as session:
        markup = store.get_message(session, message_id).body_html
    if not markup or "cid:" not in markup.lower():
        return False
    _, repaired = extract_bodies(parse_raw_message(_fetch_raw(message_id)))
    if repaired is None or repaired == markup:
        return False
    with store.session_scope() as session:
        store.get_message(session, message_id).body_html = repaired
    return True


def all_attachments(message_id: str) -> list[Attachment]:
    """
    Download every attachment of a stored message from its server (one fetch)

    Args:
        message_id (str): message id
    Returns:
        list[Attachment]: files, empty when none
    Raises:
        NotFoundError: when the message does not exist
        MailServerError: when the server fails
    """
    return extract_attachments(_fetch_raw(message_id))


def _fetch_raw(message_id: str) -> bytes:
    """
    Download the raw source of a stored message from its server

    Args:
        message_id (str): message id
    Returns:
        bytes: RFC 822 message
    Raises:
        NotFoundError: when the message does not exist
        MailServerError: when the server fails
    """
    with store.session_scope() as session:
        message = store.get_message(session, message_id)
        link = store.link_of(store.get_account(session, message.account_id))
        ref = ref_of(message)
    return transport_for(link).fetch_raw(ref)


def mark_all_read(account_ids: Sequence[str], view: str) -> int:
    """
    Mark every unread message of a view read (locally only)

    Args:
        account_ids (Sequence[str]): only these accounts, empty for all
        view (str): mailbox view
    Returns:
        int: messages marked
    """
    with store.session_scope() as session:
        priority = store.priority_column()
        statement = (
            select(MailMessage)
            .outerjoin(MailSender, MailSender.email == MailMessage.sender_email)
            .where(store.view_filter(view, priority), MailMessage.is_read.is_(False))
        )
        if account_ids:
            statement = statement.where(store.account_filter(account_ids))
        messages = list(session.scalars(statement))
        for message in messages:
            message.is_read = True
        return len(messages)


def brief_of(message: MailMessage) -> MailBrief:
    """
    LLM view of a message

    Args:
        message (MailMessage): message
    Returns:
        MailBrief: brief
    """
    sender = (
        f"{message.sender_name} <{message.sender_email}>"
        if message.sender_name
        else message.sender_email
    )
    return MailBrief(sender, message.subject, message.date, message.body_text)


def summarize_message(message_id: str, llm: LlmCall) -> str:
    """
    Triage a message with the AI and store the result

    Args:
        message_id (str): message id
        llm (LlmCall): prompt → answer
    Returns:
        str: message id
    Raises:
        AssistantError: when the AI answer is unusable
    """
    with store.session_scope() as session:
        brief = brief_of(store.get_message(session, message_id))
    insight = summarize(brief, llm)
    with store.session_scope() as session:
        message = store.get_message(session, message_id)
        message.summary = insight.summary
        message.needs_reply = insight.needs_reply
        message.suggested_action = insight.action
    return message_id


def digest(account_ids: Sequence[str], llm: LlmCall) -> str:
    """
    Brief the unread inbox (priority first) with the AI

    Args:
        account_ids (Sequence[str]): only these accounts, empty for all
        llm (LlmCall): prompt → answer
    Returns:
        str: markdown briefing
    Raises:
        AssistantError: when nothing is unread or the AI answer is empty
    """
    with store.session_scope() as session:
        query = store.MessageQuery(
            view="unread", account_ids=tuple(account_ids), limit=MAX_DIGEST_MAILS
        )
        ids = [str(row["id"]) for row in store.list_messages(session, query)]
        briefs = [
            brief_of(store.get_message(session, message_id)) for message_id in ids
        ]
    return write_digest(briefs, llm)


def reply_draft(message_id: str, instruction: str, llm: LlmCall) -> str:
    """
    Draft a reply body with the AI, using the note kept about the sender

    Args:
        message_id (str): message to answer
        instruction (str): what to say
        llm (LlmCall): prompt → answer
    Returns:
        str: reply body
    Raises:
        AssistantError: when the AI answer is empty
    """
    with store.session_scope() as session:
        message = store.get_message(session, message_id)
        brief = brief_of(message)
        note = store.get_sender(session, message.sender_email).note
    return draft_reply(brief, instruction, note, llm)


@dataclass(frozen=True)
class SendRequest:
    """Message to send from an account (optionally answering a stored message)."""

    account_id: str
    to: list[str]
    cc: list[str]
    subject: str
    body: str
    reply_to_id: str | None = None
    quote: str = ""
    body_html: str | None = None
    attachment_ids: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)


def send(request: SendRequest) -> None:
    """
    Send a message; a reply carries threading headers and marks the original read

    Args:
        request (SendRequest): message
    Raises:
        MailServerError: when the server refuses
        NotFoundError: when the account or replied message does not exist
    """
    with store.session_scope() as session:
        account = store.get_account(session, request.account_id)
        outgoing = _outgoing(session, account, request)
        link = store.link_of(account)
        reply_to = (
            ref_of(store.get_message(session, request.reply_to_id))
            if request.reply_to_id
            else None
        )
    transport_for(link).send(outgoing, reply_to)
    if request.reply_to_id:
        set_state(request.reply_to_id, True, None)


def _outgoing(
    session: Session, account: MailAccount, request: SendRequest
) -> OutgoingMail:
    """
    Build the outgoing message: signature of the account, threading headers on replies

    Args:
        session (Session): session
        account (MailAccount): sending account
        request (SendRequest): message
    Returns:
        OutgoingMail: message
    """
    in_reply_to: str | None = None
    thread_refs: str | None = None
    if request.reply_to_id:
        original = store.get_message(session, request.reply_to_id)
        in_reply_to, thread_refs = original.message_id, original.thread_refs
    body = compose_body(
        request.body, account.signature, request.quote, request.body_html
    )
    return OutgoingMail(
        sender_email=account.email,
        sender_name=account.label,
        to=request.to,
        cc=request.cc,
        bcc=request.bcc,
        subject=request.subject,
        body=body.text,
        in_reply_to=in_reply_to,
        thread_refs=thread_refs,
        html_body=body.html,
        attachments=uploads.load_files(session, request.attachment_ids),
    )

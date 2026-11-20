"""Mail client routes: accounts, sync, messages, senders and AI helpers."""

import logging
import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date
from typing import Literal
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field, validator

from controllers.mail import (
    address_book,
    drafts,
    outbox,
    service,
    store,
    trash,
    uploads,
)
from controllers.mail.assistant import AssistantError
from controllers.mail.imap_client import MailServerError
from controllers.mail.llm import MailAiError, ask_mail_llm
from controllers.mail.parser import Attachment
from controllers.mail.providers import provider_presets
from controllers.mail.smtp_client import MailFile
from controllers.mail.transport import PROTOCOLS, transport_for
from controllers.mail.triage import CATEGORIES, SENDER_FLAGS
from controllers.MailManager import MailManager
from db import MailAccount, MailMessage

HTTP_NOT_FOUND = 404
HTTP_BAD_REQUEST = 400
HTTP_CONFLICT = 409
HTTP_TOO_LARGE = 413
HTTP_UNPROCESSABLE = 422
HTTP_BAD_GATEWAY = 502
MAX_PORT = 65535
SMTP_SSL_PORT = 465
DEFAULT_COLOR = "#3b82f6"
MAX_SIGNATURE_CHARS = 5_000
HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}")
MAX_PAGE = store.MAX_PAGE

router = APIRouter(prefix="/mail", tags=["Mail"])
logger = logging.getLogger(__name__)


JsonDict = dict[str, object]


@contextmanager
def http_errors() -> Iterator[None]:
    """
    Map mail-client errors to HTTP errors

    Returns:
        Iterator[None]: guarded block
    Raises:
        HTTPException: 404 (not found), 422 (AI answer), 502 (mail server, AI provider)
    """
    try:
        yield
    except store.NotFoundError as error:
        raise HTTPException(status_code=HTTP_NOT_FOUND, detail=str(error)) from error
    except AssistantError as error:
        raise HTTPException(
            status_code=HTTP_UNPROCESSABLE, detail=str(error)
        ) from error
    except (MailServerError, MailAiError) as error:
        raise HTTPException(status_code=HTTP_BAD_GATEWAY, detail=str(error)) from error


LLM: Callable[[str], str] = ask_mail_llm


# MARK: accounts


class AccountBody(BaseModel):
    """Account form (empty password on update = keep the stored one)."""

    label: str = Field("", max_length=128)
    protocol: str = "imap"
    color: str = DEFAULT_COLOR
    signature: str = Field("", max_length=MAX_SIGNATURE_CHARS)
    email: str = Field(..., min_length=3, max_length=255)
    username: str = Field("", max_length=255)
    password: str = ""
    imap_host: str = Field(..., min_length=1, max_length=255)
    imap_port: int = Field(..., ge=1, le=MAX_PORT)
    smtp_host: str = Field("", max_length=255)
    smtp_port: int = Field(SMTP_SSL_PORT, ge=1, le=MAX_PORT)

    @validator("color")
    def check_color(cls, value: str) -> str:
        """
        Accept #rrggbb colors only

        Args:
            value (str): color
        Returns:
            str: lowercase color
        Raises:
            ValueError: when not a 6-digit hex color
        """
        if HEX_COLOR.fullmatch(value.strip()) is None:
            raise ValueError("Color must look like #3b82f6.")
        return value.strip().lower()

    @validator("protocol")
    def check_protocol(cls, value: str) -> str:
        """
        Accept known protocols only

        Args:
            value (str): protocol
        Returns:
            str: protocol
        Raises:
            ValueError: when unknown
        """
        if value not in PROTOCOLS:
            raise ValueError(f"Protocol must be one of {', '.join(PROTOCOLS)}.")
        return value

    @validator("smtp_host", always=True)
    def check_smtp_host(cls, value: str, values: dict[str, object]) -> str:
        """
        Require an SMTP server for IMAP accounts (Exchange sends through EWS)

        Args:
            value (str): SMTP host
            values (dict[str, object]): fields validated so far
        Returns:
            str: trimmed host
        Raises:
            ValueError: when an IMAP account has no SMTP host
        """
        if values.get("protocol") == "imap" and not value.strip():
            raise ValueError("SMTP server required.")
        return value.strip()

    @validator("email")
    def check_email(cls, value: str) -> str:
        """
        Accept one bare address (no display name, no spaces)

        Args:
            value (str): typed email
        Returns:
            str: trimmed address
        Raises:
            ValueError: when the value is not a single address
        """
        address = value.strip()
        if "@" not in address or any(char.isspace() for char in address):
            raise ValueError("Email must be a single address like name@example.org.")
        return address

    def to_input(self) -> store.AccountInput:
        """
        Convert to the store input

        Returns:
            store.AccountInput: account fields
        """
        return store.AccountInput(**self.dict())


@router.get("/providers")
def list_providers() -> list[dict[str, object]]:
    """
    List the server presets of common providers

    Returns:
        list[dict[str, object]]: presets
    """
    return provider_presets()


@router.get("/accounts")
def get_accounts() -> list[JsonDict]:
    """
    List mail accounts (passwords never leave the backend)

    Returns:
        list[JsonDict]: accounts
    """
    with store.session_scope() as session:
        return [store.account_view(account) for account in store.list_accounts(session)]


@router.post("/accounts")
def create_account(body: AccountBody) -> JsonDict:
    """
    Add an account after checking its IMAP login

    Args:
        body (AccountBody): account form
    Returns:
        JsonDict: created account
    Raises:
        HTTPException: 400 without password, 502 when the login fails
    """
    if not body.password:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail="Password required.")
    account = MailAccount()
    store.apply_account(account, body.to_input())
    with http_errors():
        transport_for(store.link_of(account)).check()
    with store.session_scope() as session:
        session.add(account)
        session.flush()
        return store.account_view(account)


@router.put("/accounts/{account_id}")
def update_account(account_id: str, body: AccountBody) -> JsonDict:
    """
    Edit an account and check its IMAP login

    Args:
        account_id (str): account id
        body (AccountBody): account form
    Returns:
        JsonDict: updated account
    Raises:
        HTTPException: 404 unknown account, 502 when the login fails
    """
    with http_errors(), store.session_scope() as session:
        account = store.get_account(session, account_id)
        store.apply_account(account, body.to_input())
        transport_for(store.link_of(account)).check()
        return store.account_view(account)


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str) -> JsonDict:
    """
    Remove an account and its stored messages

    Args:
        account_id (str): account id
    Returns:
        JsonDict: confirmation
    Raises:
        HTTPException: 404 unknown account
    """
    with http_errors(), store.session_scope() as session:
        account = store.get_account(session, account_id)
        session.query(MailMessage).filter_by(account_id=account_id).delete()
        session.delete(account)
    return {"deleted": account_id}


@router.post("/sync")
def sync(account_id: str | None = None) -> list[JsonDict]:
    """
    Fetch new messages of one account or of all of them

    Args:
        account_id (str | None): only this account
    Returns:
        list[JsonDict]: per account: fetched count and error
    Raises:
        HTTPException: 404 unknown account
    """
    with http_errors():
        results = (
            [service.sync_account(account_id)] if account_id else service.sync_all()
        )
    trash.purge_expired(trash.retention_days())
    return [
        {
            "account_id": result.account_id,
            "fetched": result.fetched,
            "error": result.error,
        }
        for result in results
    ]


# MARK: messages


def message_filters(
    from_text: str | None = None,
    to_text: str | None = None,
    since: date | None = None,
    until: date | None = None,
    category: str | None = None,
    unread: bool | None = None,
    attachments: bool | None = None,
) -> store.MessageFilters:
    """
    Read the search filters of the message list (query parameters)

    Args:
        from_text (str | None): text in the sender name or address
        to_text (str | None): text in the To or Cc addresses
        since (date | None): first day included
        until (date | None): last day included
        category (str | None): person, newsletter or notification
        unread (bool | None): only unread (true) or read (false) mail
        attachments (bool | None): only mail with (true) or without (false) files
    Returns:
        store.MessageFilters: filters
    Raises:
        HTTPException: 400 unknown category or reversed dates
    """
    if category is not None and category not in CATEGORIES:
        raise HTTPException(
            status_code=HTTP_BAD_REQUEST, detail=f"Unknown category {category}."
        )
    if since is not None and until is not None and since > until:
        raise HTTPException(
            status_code=HTTP_BAD_REQUEST, detail="Start date after end date."
        )
    return store.MessageFilters(
        from_text, to_text, since, until, category, unread, attachments
    )


# Module-level dependency (a call in the signature trips ruff B008).
MESSAGE_FILTERS = Depends(message_filters)


@router.get("/messages")
def list_messages(
    view: str = "inbox",
    account_id: str | None = None,
    search: str | None = None,
    sender: str | None = None,
    contact_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    filters: store.MessageFilters = MESSAGE_FILTERS,
) -> list[JsonDict]:
    """
    List the messages of a mailbox view, newest first

    Args:
        view (str): inbox, priority, others, unread, flagged, needs_reply, blocked,
            all, sent, pinned
        account_id (str | None): only this account
        search (str | None): text in subject, sender or preview
        sender (str | None): only this sender address
        contact_id (str | None): only mail from this People contact
        limit (int): page size (max 200)
        offset (int): page start
        filters (store.MessageFilters): search filters (see message_filters)
    Returns:
        list[JsonDict]: message summaries
    Raises:
        HTTPException: 400 unknown view or bad paging
    """
    if view not in store.MAIL_VIEWS:
        raise HTTPException(
            status_code=HTTP_BAD_REQUEST, detail=f"Unknown view {view}."
        )
    if not 1 <= limit <= MAX_PAGE or offset < 0:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail="Bad paging.")
    query = store.MessageQuery(
        view, account_id, search, sender, limit, offset, contact_id, filters
    )
    with store.session_scope() as session:
        return store.list_messages(session, query)


@router.get("/counts")
def counts(account_id: str | None = None) -> dict[str, int]:
    """
    Count unread messages per view

    Args:
        account_id (str | None): only this account
    Returns:
        dict[str, int]: view → count
    """
    with store.session_scope() as session:
        return store.view_counts(session, account_id)


@router.get("/messages/{message_id}")
def get_message(message_id: str) -> JsonDict:
    """
    One message with bodies and sender

    Args:
        message_id (str): message id
    Returns:
        JsonDict: message
    Raises:
        HTTPException: 404 unknown message
    """
    with http_errors():
        try:
            service.repair_inline_images(message_id)
        except MailServerError as error:
            logger.warning("Inline images of %s not embedded: %s", message_id, error)
    with http_errors(), store.session_scope() as session:
        return store.message_detail(session, store.get_message(session, message_id))


def content_disposition(filename: str) -> str:
    """
    Build an attachment Content-Disposition header keeping non-ASCII names

    Args:
        filename (str): file name
    Returns:
        str: header value with an ASCII fallback and the UTF-8 name
    """
    fallback = filename.encode("ascii", "replace").decode().replace('"', "_")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


def attachment_response(file: Attachment) -> Response:
    """
    Serve an attachment as a download that never runs as a page of the app

    Args:
        file (Attachment): attachment
    Returns:
        Response: file bytes with download and sandbox headers
    """
    return Response(
        content=file.data,
        media_type=file.content_type,
        headers={
            "Content-Disposition": content_disposition(file.filename),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )


@router.get("/messages/{message_id}/attachments/{index}")
def get_attachment(message_id: str, index: int = Path(..., ge=0)) -> Response:
    """
    Download one attachment (fetched from the mail server)

    Args:
        message_id (str): message id
        index (int): attachment position, 0 = first
    Returns:
        Response: file
    Raises:
        HTTPException: 404 unknown message or attachment, 502 mail server failure
    """
    with http_errors():
        file = service.attachment(message_id, index)
    return attachment_response(file)


@router.post("/messages/{message_id}/forward-attachments")
def forward_attachments(message_id: str) -> list[JsonDict]:
    """
    Copy a message's attachments into uploads, to attach them to its forward

    Args:
        message_id (str): forwarded message id
    Returns:
        list[JsonDict]: stored attachments (files above the size limit skipped)
    Raises:
        HTTPException: 404 unknown message, 502 mail server failure
    """
    with http_errors():
        files = service.all_attachments(message_id)
    return uploads.save_forwarded(
        [MailFile(file.filename, file.content_type, file.data) for file in files]
    )


class StateBody(BaseModel):
    """Read/flag change (None = unchanged)."""

    is_read: bool | None = None
    is_flagged: bool | None = None
    is_pinned: bool | None = None
    is_activity: bool | None = None


@router.patch("/messages/{message_id}")
def set_state(message_id: str, body: StateBody) -> JsonDict:
    """
    Mark a message read/unread or flagged, then push the change to the server

    Args:
        message_id (str): message id
        body (StateBody): change
    Returns:
        JsonDict: server error, if any (the local change is kept)
    Raises:
        HTTPException: 404 unknown message
    """
    with http_errors():
        if body.is_pinned is not None:
            service.set_pinned(message_id, body.is_pinned)
        if body.is_activity is not None:
            service.set_activity(message_id, body.is_activity)
        error = service.set_state(message_id, body.is_read, body.is_flagged)
    return {"server_error": error}


class MarkAllBody(BaseModel):
    """View to mark read."""

    view: str = "inbox"
    account_id: str | None = None


@router.post("/messages/read-all")
def mark_all_read(body: MarkAllBody) -> JsonDict:
    """
    Mark every unread message of a view read (local only)

    Args:
        body (MarkAllBody): view and account
    Returns:
        JsonDict: messages marked
    """
    return {"marked": service.mark_all_read(body.account_id, body.view)}


@router.post("/messages/{message_id}/summarize")
def summarize(message_id: str) -> JsonDict:
    """
    Summarize a message with the AI (summary, needs reply, next action)

    Args:
        message_id (str): message id
    Returns:
        JsonDict: updated message
    Raises:
        HTTPException: 404 unknown message, 422/502 AI failure
    """
    with http_errors():
        service.summarize_message(message_id, LLM)
    return get_message(message_id)


class PreviewBody(BaseModel):
    """Messages to preview."""

    ids: list[str] = Field(..., min_items=1, max_items=MAX_PAGE)


@router.post("/previews")
def queue_previews(body: PreviewBody) -> JsonDict:
    """
    Queue Mail Previews (AI title + 40-word summary) of messages

    Args:
        body (PreviewBody): message ids
    Returns:
        JsonDict: messages queued (already queued ones are skipped)
    """
    return {"queued": MailManager.queue_previews(body.ids)}


@router.get("/previews/pending")
def pending_previews() -> JsonDict:
    """
    Count Mail Previews waiting or running (the front polls it to refresh)

    Returns:
        JsonDict: open tasks
    """
    return {"pending": MailManager.pending_count()}


class ReplyDraftBody(BaseModel):
    """What the reply should say."""

    instruction: str = Field("", max_length=2_000)


@router.post("/messages/{message_id}/draft-reply")
def draft_reply(message_id: str, body: ReplyDraftBody) -> JsonDict:
    """
    Draft a reply with the AI

    Args:
        message_id (str): message id
        body (ReplyDraftBody): instruction
    Returns:
        JsonDict: reply body
    Raises:
        HTTPException: 404 unknown message, 422/502 AI failure
    """
    with http_errors():
        return {"body": service.reply_draft(message_id, body.instruction, LLM)}


class DigestBody(BaseModel):
    """Account to brief."""

    account_id: str | None = None


@router.post("/digest")
def digest(body: DigestBody) -> JsonDict:
    """
    Brief the unread messages with the AI

    Args:
        body (DigestBody): account
    Returns:
        JsonDict: markdown briefing
    Raises:
        HTTPException: 422/502 AI failure
    """
    with http_errors():
        return {"markdown": service.digest(body.account_id, LLM)}


class SendBody(BaseModel):
    """Message to send (body = written text; signature and quote added by the server)."""

    account_id: str
    to: list[str] = Field(..., min_items=1)
    cc: list[str] = Field(default_factory=list)
    subject: str = Field("", max_length=1_000)
    body: str = ""
    # Formatted body (inline images as data URIs), None = plain text only.
    body_html: str | None = None
    quote: str = ""
    reply_to_id: str | None = None
    # Files uploaded with POST /mail/uploads, in order.
    attachment_ids: list[str] = Field(default_factory=list)
    # Draft the message was written in: removed once queued.
    draft_id: str | None = None

    @validator("to", "cc", each_item=True)
    def check_address(cls, value: str) -> str:
        """
        Reject values that are not email addresses

        Args:
            value (str): address
        Returns:
            str: trimmed address
        Raises:
            ValueError: when the value has no "@"
        """
        if "@" not in value:
            raise ValueError(f"Invalid address: {value}")
        return value.strip()


@router.post("/send")
def send(body: SendBody) -> JsonDict:
    """
    Queue a message in the Outbox (reply when reply_to_id is set)

    Args:
        body (SendBody): message
    Returns:
        JsonDict: queued Outbox message
    Raises:
        HTTPException: 404 unknown account
    """
    request = service.SendRequest(
        body.account_id,
        body.to,
        body.cc,
        body.subject,
        body.body,
        body.reply_to_id,
        body.quote,
        body.body_html,
        body.attachment_ids,
    )
    with http_errors():
        return outbox.enqueue(request, body.draft_id)


# MARK: uploads


@router.post("/uploads")
async def upload_attachment(file: UploadFile) -> JsonDict:
    """
    Store a file to attach to a message being written

    Args:
        file (UploadFile): file
    Returns:
        JsonDict: attachment id, name, type and size
    Raises:
        HTTPException: 413 above the size limit
    """
    data = await file.read(uploads.MAX_UPLOAD_BYTES + 1)
    try:
        return uploads.save_upload(file.filename, file.content_type, data)
    except uploads.UploadTooLargeError as error:
        raise HTTPException(status_code=HTTP_TOO_LARGE, detail=str(error)) from error


# MARK: outbox


@router.get("/outbox")
def list_outbox() -> list[JsonDict]:
    """
    List messages waiting to be sent (queued, sending or failed)

    Returns:
        list[JsonDict]: Outbox, oldest first
    """
    return outbox.list_outbox()


@router.post("/outbox/{outgoing_id}/retry")
def retry_outgoing(outgoing_id: str) -> JsonDict:
    """
    Queue a failed message again

    Args:
        outgoing_id (str): Outbox id
    Returns:
        JsonDict: queued message
    Raises:
        HTTPException: 404 not in the Outbox
    """
    with http_errors():
        return outbox.retry(outgoing_id)


@router.delete("/outbox/{outgoing_id}")
def discard_outgoing(outgoing_id: str) -> JsonDict:
    """
    Remove a message from the Outbox (refused while it is being sent)

    Args:
        outgoing_id (str): Outbox id
    Returns:
        JsonDict: removed id
    Raises:
        HTTPException: 404 not in the Outbox, 409 being sent
    """
    with http_errors():
        removed = outbox.discard(outgoing_id)
    if not removed:
        raise HTTPException(status_code=HTTP_CONFLICT, detail="Message is being sent.")
    return {"deleted": outgoing_id}


# MARK: drafts


class DraftBody(BaseModel):
    """Compose dialog fields to keep (addresses may still be incomplete)."""

    account_id: str
    kind: Literal["new", "reply", "forward"] = "new"
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    subject: str = Field("", max_length=1_000)
    body: str = ""
    # Formatted body (inline images as data URIs), None = plain text only.
    body_html: str | None = None
    quote: str = ""
    reply_to_id: str | None = None
    # Files uploaded with POST /mail/uploads, in order.
    attachment_ids: list[str] = Field(default_factory=list)

    def content(self) -> drafts.DraftContent:
        """
        Convert to the controller's draft content

        Returns:
            drafts.DraftContent: fields
        """
        return drafts.DraftContent(
            account_id=self.account_id,
            kind=self.kind,
            to=self.to,
            cc=self.cc,
            subject=self.subject,
            body=self.body,
            quote=self.quote,
            reply_to_id=self.reply_to_id,
            body_html=self.body_html,
            attachment_ids=self.attachment_ids,
        )


@router.get("/drafts")
def list_drafts() -> list[JsonDict]:
    """
    List saved drafts, last edited first

    Returns:
        list[JsonDict]: drafts
    """
    return drafts.list_drafts()


@router.post("/drafts")
def create_draft(body: DraftBody) -> JsonDict:
    """
    Save a new draft

    Args:
        body (DraftBody): compose fields
    Returns:
        JsonDict: saved draft
    Raises:
        HTTPException: 404 unknown account
    """
    with http_errors():
        return drafts.save_draft(body.content())


@router.put("/drafts/{draft_id}")
def update_draft(draft_id: str, body: DraftBody) -> JsonDict:
    """
    Overwrite a draft

    Args:
        draft_id (str): draft id
        body (DraftBody): compose fields
    Returns:
        JsonDict: saved draft
    Raises:
        HTTPException: 404 unknown account or draft
    """
    with http_errors():
        return drafts.save_draft(body.content(), draft_id)


@router.delete("/drafts/{draft_id}")
def delete_draft(draft_id: str) -> JsonDict:
    """
    Move a draft to the Trash

    Args:
        draft_id (str): draft id
    Returns:
        JsonDict: trashed id
    Raises:
        HTTPException: 404 draft not in the Drafts box
    """
    with http_errors():
        drafts.trash_draft(draft_id)
    return {"deleted": draft_id}


@router.post("/drafts/{draft_id}/restore")
def restore_draft(draft_id: str) -> JsonDict:
    """
    Put a trashed draft back in the Drafts box

    Args:
        draft_id (str): draft id
    Returns:
        JsonDict: restored id
    Raises:
        HTTPException: 404 draft not in the Trash
    """
    with http_errors():
        drafts.restore_draft(draft_id)
    return {"restored": draft_id}


# MARK: trash


@router.delete("/messages/{message_id}")
def delete_message(message_id: str) -> JsonDict:
    """
    Move a message to the Trash (local only, the server copy stays)

    Args:
        message_id (str): message id
    Returns:
        JsonDict: trashed id
    Raises:
        HTTPException: 404 unknown or already trashed message
    """
    with http_errors():
        trash.trash_message(message_id)
    return {"deleted": message_id}


@router.post("/messages/{message_id}/restore")
def restore_message(message_id: str) -> JsonDict:
    """
    Put a trashed message back in its views

    Args:
        message_id (str): message id
    Returns:
        JsonDict: restored id
    Raises:
        HTTPException: 404 message not in the Trash
    """
    with http_errors():
        trash.restore_message(message_id)
    return {"restored": message_id}


@router.get("/trash")
def list_trash() -> JsonDict:
    """
    List the Trash after purging items older than the retention period

    Returns:
        JsonDict: retention_days, messages, drafts
    """
    days = trash.retention_days()
    trash.purge_expired(days)
    return trash.list_trash(days)


@router.delete("/trash")
def empty_trash() -> JsonDict:
    """
    Remove every Trash item for good

    Returns:
        JsonDict: items purged
    """
    return {"purged": trash.purge_before(None)}


# MARK: senders


@router.get("/senders")
def list_senders(flag: str | None = None, search: str | None = None) -> list[JsonDict]:
    """
    List senders with their treatment and stats

    Args:
        flag (str | None): only this flag
        search (str | None): text in name or address
    Returns:
        list[JsonDict]: senders
    """
    with store.session_scope() as session:
        return store.list_senders(session, flag, search)


@router.get("/addresses")
def suggest_addresses(
    search: str = "",
    limit: int = Query(
        address_book.DEFAULT_SUGGESTIONS, ge=1, le=address_book.MAX_SUGGESTIONS
    ),
) -> list[JsonDict]:
    """
    Suggest addresses already seen in stored mail (senders, recipients, cc)

    Args:
        search (str): text in address or name
        limit (int): maximum suggestions
    Returns:
        list[JsonDict]: addresses, most frequent then most recent first
    """
    with store.session_scope() as session:
        return [
            seen.view()
            for seen in address_book.suggest_addresses(session, search, limit)
        ]


class SenderBody(BaseModel):
    """Sender treatment (None = unchanged)."""

    flag: str | None = None
    note: str | None = Field(None, max_length=10_000)

    @validator("flag")
    def check_flag(cls, value: str | None) -> str | None:
        """
        Reject unknown flags

        Args:
            value (str | None): flag
        Returns:
            str | None: flag
        Raises:
            ValueError: when the flag is unknown
        """
        if value is not None and value not in SENDER_FLAGS:
            raise ValueError(f"Flag must be one of {', '.join(SENDER_FLAGS)}.")
        return value


@router.put("/senders/{email}")
def update_sender(email: str, body: SenderBody) -> JsonDict:
    """
    Flag a sender (vip, normal, muted, blocked) or edit the note kept about them

    Args:
        email (str): address
        body (SenderBody): changes
    Returns:
        JsonDict: sender
    """
    with store.session_scope() as session:
        sender = store.update_sender(session, email, body.flag, body.note)
        session.flush()
        return store.sender_view(session, sender)


@router.post("/senders/{email}/contact")
def link_contact(email: str) -> JsonDict:
    """
    Link a sender to People, creating the contact when needed

    Args:
        email (str): address
    Returns:
        JsonDict: contact id
    """
    with store.session_scope() as session:
        return {"contact_id": store.link_contact(session, email)}

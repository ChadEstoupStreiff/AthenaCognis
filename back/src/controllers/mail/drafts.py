"""Drafts box: messages saved from the compose dialog, resumed or sent later."""

import json
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from controllers.mail import store, uploads
from db import MailDraft

DRAFT_KINDS = frozenset({"new", "reply", "forward"})

JsonDict = dict[str, object]


@dataclass(frozen=True)
class DraftContent:
    """Compose dialog fields saved in a draft."""

    account_id: str
    kind: str = "new"
    to: list[str] = field(default_factory=list)
    cc: list[str] = field(default_factory=list)
    subject: str = ""
    body: str = ""
    quote: str = ""
    reply_to_id: str | None = None
    body_html: str | None = None
    attachment_ids: list[str] = field(default_factory=list)


def draft_view(draft: MailDraft) -> JsonDict:
    """
    Serialize a draft

    Args:
        draft (MailDraft): row
    Returns:
        JsonDict: draft fields
    """
    return {
        "id": draft.id,
        "account_id": draft.account_id,
        "kind": draft.kind,
        "to": json.loads(draft.recipients),
        "cc": json.loads(draft.cc),
        "subject": draft.subject,
        "body": draft.body,
        "body_html": draft.body_html,
        "attachments": _attachments(draft),
        "quote": draft.quote,
        "reply_to_id": draft.reply_to_id,
        "updated": draft.updated.isoformat(),
        "trashed_at": draft.trashed_at.isoformat() if draft.trashed_at else None,
    }


def _attachments(draft: MailDraft) -> list[JsonDict]:
    """
    Serialize the attachments of a draft

    Args:
        draft (MailDraft): row (attached to a session when it has attachments)
    Returns:
        list[JsonDict]: attachments still stored
    """
    session = object_session(draft)
    if session is None or not draft.attachments:
        return []
    return uploads.upload_views(session, draft.attachments)


def get_draft(session: Session, draft_id: str, trashed: bool = False) -> MailDraft:
    """
    Load one draft of the Drafts box, or of the Trash

    Args:
        session (Session): session
        draft_id (str): id
        trashed (bool): look in the Trash instead of the Drafts box
    Returns:
        MailDraft: row
    Raises:
        NotFoundError: when it is not there (sent, deleted or purged)
    """
    draft = session.get(MailDraft, draft_id)
    if draft is None or (draft.trashed_at is not None) != trashed:
        box = "Trash" if trashed else "Drafts"
        raise store.NotFoundError(f"Draft {draft_id} not found in {box}.")
    return draft


def fill(draft: MailDraft, content: DraftContent) -> None:
    """
    Copy compose fields into a draft row and stamp it

    Args:
        draft (MailDraft): row
        content (DraftContent): fields
    Raises:
        ValueError: when the kind is unknown
    """
    if content.kind not in DRAFT_KINDS:
        raise ValueError(f"Unknown draft kind: {content.kind}")
    draft.account_id = content.account_id
    draft.kind = content.kind
    draft.recipients = json.dumps(content.to)
    draft.cc = json.dumps(content.cc)
    draft.subject = content.subject
    draft.body = content.body
    draft.body_html = content.body_html
    draft.attachments = uploads.encode_ids(content.attachment_ids)
    draft.quote = content.quote
    draft.reply_to_id = content.reply_to_id
    draft.updated = store.utc_now()


def save_draft(content: DraftContent, draft_id: str | None = None) -> JsonDict:
    """
    Create a draft, or overwrite an existing one

    Args:
        content (DraftContent): fields
        draft_id (str | None): draft to overwrite, None creates one
    Returns:
        JsonDict: saved draft
    Raises:
        NotFoundError: when the account or the draft does not exist
        ValueError: when the kind is unknown
    """
    with store.session_scope() as session:
        store.get_account(session, content.account_id)
        draft = MailDraft() if draft_id is None else get_draft(session, draft_id)
        fill(draft, content)
        session.add(draft)
        session.flush()
        return draft_view(draft)


def list_drafts() -> list[JsonDict]:
    """
    List drafts, last edited first

    Returns:
        list[JsonDict]: drafts
    """
    with store.session_scope() as session:
        rows = session.scalars(
            select(MailDraft)
            .where(MailDraft.trashed_at.is_(None))
            .order_by(MailDraft.updated.desc())
        )
        return [draft_view(draft) for draft in rows]


def trash_draft(draft_id: str) -> None:
    """
    Move a draft to the Trash

    Args:
        draft_id (str): id
    Raises:
        NotFoundError: when it is not in the Drafts box
    """
    with store.session_scope() as session:
        get_draft(session, draft_id).trashed_at = store.utc_now()


def restore_draft(draft_id: str) -> None:
    """
    Put a trashed draft back in the Drafts box

    Args:
        draft_id (str): id
    Raises:
        NotFoundError: when it is not in the Trash
    """
    with store.session_scope() as session:
        get_draft(session, draft_id, trashed=True).trashed_at = None


def drop_sent_draft(session: Session, draft_id: str | None) -> None:
    """
    Remove the draft a sent message came from, if it still exists

    Args:
        session (Session): session of the send
        draft_id (str | None): draft id, None when not sent from a draft
    """
    if draft_id is None:
        return
    draft = session.get(MailDraft, draft_id)
    if draft is not None:
        session.delete(draft)

"""Outbox: messages queued by the compose dialog, sent in the background."""

import json
import logging
import threading
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from controllers.mail import drafts, service, store
from controllers.mail.imap_client import MailServerError
from db import MailOutgoing

QUEUED = "queued"
SENDING = "sending"
FAILED = "failed"
IDLE_POLL_SECONDS = 30.0

JsonDict = dict[str, object]

logger = logging.getLogger(__name__)


def now() -> datetime:
    """
    Current naive UTC time (the stored convention)

    Returns:
        datetime: now
    """
    return datetime.now(UTC).replace(tzinfo=None)


def outgoing_view(outgoing: MailOutgoing) -> JsonDict:
    """
    Serialize an Outbox message

    Args:
        outgoing (MailOutgoing): row
    Returns:
        JsonDict: message fields, state and last error
    """
    return {
        "id": outgoing.id,
        "account_id": outgoing.account_id,
        "to": json.loads(outgoing.recipients),
        "cc": json.loads(outgoing.cc),
        "subject": outgoing.subject,
        "body": outgoing.body,
        "created": outgoing.created.isoformat(),
        "state": outgoing.state,
        "error": outgoing.error,
        "attempts": outgoing.attempts,
    }


def get_outgoing(session: Session, outgoing_id: str) -> MailOutgoing:
    """
    Load one Outbox message

    Args:
        session (Session): session
        outgoing_id (str): id
    Returns:
        MailOutgoing: row
    Raises:
        NotFoundError: when it is not (or no longer) in the Outbox
    """
    outgoing = session.get(MailOutgoing, outgoing_id)
    if outgoing is None:
        raise store.NotFoundError(f"Outbox message {outgoing_id} not found.")
    return outgoing


def enqueue(request: service.SendRequest, draft_id: str | None = None) -> JsonDict:
    """
    Put a message in the Outbox, drop the draft it came from, wake the sender

    Args:
        request (service.SendRequest): message
        draft_id (str | None): draft the message was written in, None = none
    Returns:
        JsonDict: queued message
    Raises:
        NotFoundError: when the account does not exist
    """
    with store.session_scope() as session:
        store.get_account(session, request.account_id)
        outgoing = MailOutgoing(
            account_id=request.account_id,
            recipients=json.dumps(request.to),
            cc=json.dumps(request.cc),
            subject=request.subject,
            body=request.body,
            quote=request.quote,
            reply_to_id=request.reply_to_id,
            created=now(),
            state=QUEUED,
            attempts=0,
        )
        session.add(outgoing)
        drafts.drop_sent_draft(session, draft_id)
        session.flush()
        view = outgoing_view(outgoing)
    OutboxSender.wake()
    return view


def list_outbox() -> list[JsonDict]:
    """
    List the Outbox, oldest first

    Returns:
        list[JsonDict]: messages not sent yet
    """
    with store.session_scope() as session:
        rows = session.scalars(select(MailOutgoing).order_by(MailOutgoing.created))
        return [outgoing_view(outgoing) for outgoing in rows]


def retry(outgoing_id: str) -> JsonDict:
    """
    Queue a failed message again

    Args:
        outgoing_id (str): id
    Returns:
        JsonDict: queued message
    Raises:
        NotFoundError: when it is not in the Outbox
    """
    with store.session_scope() as session:
        outgoing = get_outgoing(session, outgoing_id)
        if outgoing.state == FAILED:
            outgoing.state = QUEUED
            outgoing.error = None
        view = outgoing_view(outgoing)
    OutboxSender.wake()
    return view


def discard(outgoing_id: str) -> bool:
    """
    Remove a message from the Outbox unless it is being sent

    Args:
        outgoing_id (str): id
    Returns:
        bool: True when removed, False while it is being sent
    Raises:
        NotFoundError: when it is not in the Outbox
    """
    with store.session_scope() as session:
        outgoing = get_outgoing(session, outgoing_id)
        if outgoing.state == SENDING:
            return False
        session.delete(outgoing)
    return True


def claim_next() -> tuple[str, service.SendRequest] | None:
    """
    Mark the oldest queued message as being sent

    Returns:
        tuple[str, service.SendRequest] | None: Outbox id and content, None when idle
    """
    with store.session_scope() as session:
        outgoing = session.scalars(
            select(MailOutgoing)
            .where(MailOutgoing.state == QUEUED)
            .order_by(MailOutgoing.created)
            .limit(1)
        ).first()
        if outgoing is None:
            return None
        outgoing.state = SENDING
        outgoing.attempts += 1
        request = service.SendRequest(
            account_id=outgoing.account_id,
            to=json.loads(outgoing.recipients),
            cc=json.loads(outgoing.cc),
            subject=outgoing.subject,
            body=outgoing.body,
            reply_to_id=outgoing.reply_to_id,
            quote=outgoing.quote,
        )
        return outgoing.id, request


def mark_failed(outgoing_id: str, error: str) -> None:
    """
    Keep a message in the Outbox with the server error

    Args:
        outgoing_id (str): id
        error (str): reason shown in the Outbox
    """
    with store.session_scope() as session:
        outgoing = session.get(MailOutgoing, outgoing_id)
        if outgoing is not None:
            outgoing.state = FAILED
            outgoing.error = error


def mark_sent(outgoing_id: str) -> None:
    """
    Remove a sent message from the Outbox

    Args:
        outgoing_id (str): id
    """
    with store.session_scope() as session:
        outgoing = session.get(MailOutgoing, outgoing_id)
        if outgoing is not None:
            session.delete(outgoing)


def send_next() -> bool:
    """
    Send the oldest queued message, then sync its account so it shows in Sent

    Returns:
        bool: True when a message was processed (sent or failed), False when idle
    """
    claimed = claim_next()
    if claimed is None:
        return False
    outgoing_id, request = claimed
    try:
        service.send(request)
    except (MailServerError, store.NotFoundError) as error:
        logger.warning("Outbox message %s failed: %s", outgoing_id, error)
        mark_failed(outgoing_id, str(error))
        return True
    except Exception as error:
        logger.exception("Outbox message %s failed unexpectedly", outgoing_id)
        mark_failed(outgoing_id, f"Unexpected error: {error}")
        return True
    mark_sent(outgoing_id)
    service.sync_account(request.account_id)
    return True


def requeue_interrupted() -> int:
    """
    Queue again messages left "sending" by a stopped backend

    Returns:
        int: messages queued again
    """
    with store.session_scope() as session:
        result = session.execute(
            update(MailOutgoing)
            .where(MailOutgoing.state == SENDING)
            .values(state=QUEUED)
        )
        return int(getattr(result, "rowcount", 0) or 0)


class OutboxSender:
    """Daemon thread sending Outbox messages one at a time."""

    event = threading.Event()
    thread: threading.Thread | None = None

    @classmethod
    def wake(cls) -> None:
        """
        Make the sender look at the Outbox now

        Returns:
            None
        """
        cls.event.set()

    @classmethod
    def start(cls) -> None:
        """
        Start the sender thread once

        Returns:
            None
        """
        if cls.thread is not None:
            return
        requeue_interrupted()
        cls.thread = threading.Thread(target=cls.run, name="mail-outbox", daemon=True)
        cls.thread.start()

    @classmethod
    def run(cls) -> None:
        """
        Send queued messages, sleeping when the Outbox is empty

        Returns:
            None
        """
        while True:
            try:
                busy = send_next()
            except Exception:
                logger.exception("Outbox sender crashed on a message")
                busy = False
            if not busy:
                cls.event.wait(IDLE_POLL_SECONDS)
                cls.event.clear()

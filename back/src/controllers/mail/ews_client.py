"""Exchange Web Services (on-premises Exchange) through exchangelib."""

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta

from exchangelib import (
    DELEGATE,
    UTC,
    Account,
    Configuration,
    Credentials,
    EWSDateTime,
    HTMLBody,
    Mailbox,
    Message,
)
from exchangelib.errors import EWSError
from exchangelib.folders import Folder

from controllers.mail.imap_client import FetchedMail, MailServerError
from controllers.mail.smtp_client import OutgoingMail
from controllers.mail.transport import (
    INBOX,
    AccountLink,
    FetchBatch,
    FetchCursor,
    MailboxKind,
    MailFlag,
    MessageRef,
)

HTTP_PREFIXES = ("http://", "https://")
SENT = "Sent"
# Items received in the same second as the last stored one are refetched, then deduplicated.
OVERLAP = timedelta(seconds=1)

logger = logging.getLogger(__name__)


@contextmanager
def ews_errors(host: str) -> Iterator[None]:
    """
    Turn exchangelib and network errors into MailServerError

    Args:
        host (str): server, for the message
    Returns:
        Iterator[None]: guarded block
    Raises:
        MailServerError: on any EWS or network failure
    """
    try:
        yield
    except (EWSError, OSError, ValueError) as error:
        raise MailServerError(f"Exchange {host}: {error}") from error


def open_account(link: AccountLink) -> Account:
    """
    Connect to a mailbox without autodiscover

    Args:
        link (AccountLink): account; incoming host is a server name or a full EWS URL
    Returns:
        Account: exchangelib account
    """
    server = link.incoming
    credentials = Credentials(server.username, server.password)
    config = (
        Configuration(service_endpoint=server.host, credentials=credentials)
        if server.host.startswith(HTTP_PREFIXES)
        else Configuration(server=server.host, credentials=credentials)
    )
    return Account(
        primary_smtp_address=link.email,
        config=config,
        autodiscover=False,
        access_type=DELEGATE,
    )


def folder_of(account: Account, name: str) -> Folder:
    """
    Folder of a stored message (Sent Items or the inbox)

    Args:
        account (Account): exchangelib account
        name (str): stored folder name
    Returns:
        Folder: folder
    """
    return account.sent if name == SENT else account.inbox


def to_ews_time(value: datetime) -> EWSDateTime:
    """
    Convert a naive UTC datetime for EWS filters

    Args:
        value (datetime): naive UTC datetime
    Returns:
        EWSDateTime: aware datetime
    """
    return EWSDateTime.from_datetime(value.replace(tzinfo=UTC))


def to_fetched(item: Message, uid: int) -> FetchedMail:
    """
    Convert an EWS item (its MIME content is parsed like IMAP mail)

    Args:
        item (Message): EWS message
        uid (int): local sequence number
    Returns:
        FetchedMail: message
    """
    flag = getattr(item, "flag", None)
    return FetchedMail(
        uid=uid,
        raw=bytes(item.mime_content or b""),
        is_read=bool(item.is_read),
        is_flagged=getattr(flag, "flag_status", None) == "Flagged",
        remote_id=str(item.id),
    )


def ews_body(mail: OutgoingMail) -> str | HTMLBody:
    """
    Pick the body sent through EWS: HTML when the message has an HTML version

    Args:
        mail (OutgoingMail): message
    Returns:
        str | HTMLBody: plain text or HTML body
    """
    return mail.body if mail.html_body is None else HTMLBody(mail.html_body)


class EwsTransport:
    """Exchange mailbox over EWS (read, mark read, send, reply)."""

    def __init__(self, link: AccountLink) -> None:
        """
        Bind to an account

        Args:
            link (AccountLink): account servers
        """
        self.link = link
        self.host = link.incoming.host

    def check(self) -> None:
        """
        Verify the credentials by reading the inbox size

        Raises:
            MailServerError: when the login fails
        """
        with ews_errors(self.host):
            _ = open_account(self.link).inbox.total_count

    def fetch(
        self, mailbox: MailboxKind, cursor: FetchCursor, limit: int
    ) -> FetchBatch:
        """
        Fetch items of the inbox or Sent Items received since the last stored one

        Args:
            mailbox (MailboxKind): inbox or sent
            cursor (FetchCursor): what is already stored
            limit (int): maximum messages
        Returns:
            FetchBatch: folder and new messages, oldest first, numbered after last_uid
        Raises:
            MailServerError: when the server fails
        """
        name = INBOX if mailbox == "inbox" else SENT
        with ews_errors(self.host):
            folder = folder_of(open_account(self.link), name)
            query = (
                folder.filter(
                    datetime_received__gte=to_ews_time(cursor.last_date - OVERLAP)
                )
                if cursor.last_date
                else folder.all()
            )
            items = list(query.order_by("-datetime_received")[:limit])
        fresh = [
            item for item in reversed(items) if str(item.id) not in cursor.known_ids
        ]
        mails = [
            to_fetched(item, cursor.last_uid + index)
            for index, item in enumerate(fresh, start=1)
        ]
        return FetchBatch(name, mails)

    def set_flag(self, ref: MessageRef, flag: MailFlag, enabled: bool) -> str | None:
        """
        Mark read/unread on the server (flags stay local on Exchange)

        Args:
            ref (MessageRef): message
            flag (MailFlag): read or flagged
            enabled (bool): new state
        Returns:
            str | None: error message, None on success
        """
        if flag != "read":
            return "Flags are kept in AthenaCognis only for Exchange accounts."
        if ref.remote_id is None:
            return "Message has no Exchange id."
        try:
            with ews_errors(self.host):
                item = folder_of(open_account(self.link), ref.folder).get(
                    id=ref.remote_id
                )
                item.is_read = enabled
                item.save(update_fields=["is_read"])
        except MailServerError as error:
            logger.warning("EWS read sync failed: %s", error)
            return str(error)
        return None

    def fetch_raw(self, ref: MessageRef) -> bytes:
        """
        Fetch the MIME content of an Exchange item

        Args:
            ref (MessageRef): message
        Returns:
            bytes: RFC 822 message
        Raises:
            MailServerError: when the server fails or the item has no Exchange id
        """
        if ref.remote_id is None:
            raise MailServerError("Message has no Exchange id.")
        with ews_errors(self.host):
            item = folder_of(open_account(self.link), ref.folder).get(id=ref.remote_id)
            return bytes(item.mime_content or b"")

    def send(self, mail: OutgoingMail, reply_to: MessageRef | None) -> None:
        """
        Send, as an Exchange reply when answering a stored message (keeps the thread)

        Args:
            mail (OutgoingMail): message
            reply_to (MessageRef | None): message answered
        Raises:
            MailServerError: when the server refuses
        """
        with ews_errors(self.host):
            account = open_account(self.link)
            if reply_to is not None and reply_to.remote_id is not None:
                original = folder_of(account, reply_to.folder).get(
                    id=reply_to.remote_id
                )
                original.reply(
                    subject=mail.subject,
                    body=ews_body(mail),
                    to_recipients=mail.to,
                    cc_recipients=mail.cc or None,
                )
                return
            Message(
                account=account,
                folder=account.sent,
                subject=mail.subject,
                body=ews_body(mail),
                to_recipients=[Mailbox(email_address=address) for address in mail.to],
                cc_recipients=[Mailbox(email_address=address) for address in mail.cc],
            ).send_and_save()

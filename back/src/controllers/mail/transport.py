"""Protocol-independent access to a mailbox: IMAP/SMTP or Exchange (EWS)."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol, get_args

from controllers.mail.imap_client import (
    FLAGGED_FLAG,
    SEEN_FLAG,
    FetchedMail,
    ServerLogin,
    append_sent,
    check_login,
    fetch_message,
    fetch_new,
    find_sent_folder,
    imap_session,
    store_flag,
)
from controllers.mail.smtp_client import OutgoingMail, build_message, send_message

MailProtocol = Literal["imap", "ews"]
PROTOCOLS: tuple[str, ...] = get_args(MailProtocol)
MailFlag = Literal["read", "flagged"]
MailboxKind = Literal["inbox", "sent"]
INBOX = "INBOX"
# Gmail files SMTP-sent mail into Sent itself: appending would duplicate it.
SELF_FILING_HOSTS = ("imap.gmail.com",)

IMAP_FLAGS: dict[str, str] = {"read": SEEN_FLAG, "flagged": FLAGGED_FLAG}


@dataclass(frozen=True)
class AccountLink:
    """Everything needed to reach an account's servers (detached from the session)."""

    protocol: str
    email: str
    incoming: ServerLogin
    outgoing: ServerLogin


@dataclass(frozen=True)
class FetchCursor:
    """What is already stored: fetch only what is newer."""

    last_uid: int
    last_date: datetime | None
    known_ids: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class FetchBatch:
    """Messages fetched from one server folder."""

    folder: str
    mails: list[FetchedMail] = field(default_factory=list)


@dataclass(frozen=True)
class MessageRef:
    """Server address of a stored message."""

    folder: str
    uid: int
    remote_id: str | None


class MailTransport(Protocol):
    """Operations the mail client needs from a server."""

    def check(self) -> None:
        """
        Verify the credentials

        Raises:
            MailServerError: when the login fails
        """

    def fetch(
        self, mailbox: MailboxKind, cursor: FetchCursor, limit: int
    ) -> FetchBatch:
        """
        Fetch new messages of the inbox or the Sent folder

        Args:
            mailbox (MailboxKind): inbox or sent
            cursor (FetchCursor): what is already stored
            limit (int): maximum messages
        Returns:
            FetchBatch: server folder and messages, oldest first
        Raises:
            MailServerError: when the server fails
        """

    def set_flag(self, ref: MessageRef, flag: MailFlag, enabled: bool) -> str | None:
        """
        Push a read/flag change (best effort)

        Args:
            ref (MessageRef): message
            flag (MailFlag): read or flagged
            enabled (bool): new state
        Returns:
            str | None: error message, None on success
        """

    def fetch_raw(self, ref: MessageRef) -> bytes:
        """
        Fetch the full raw message (to extract attachments)

        Args:
            ref (MessageRef): message
        Returns:
            bytes: RFC 822 message
        Raises:
            MailServerError: when the server fails or the message is gone
        """

    def send(self, mail: OutgoingMail, reply_to: MessageRef | None) -> None:
        """
        Send a message

        Args:
            mail (OutgoingMail): message
            reply_to (MessageRef | None): message answered
        Raises:
            MailServerError: when the server refuses
        """


class ImapTransport:
    """IMAP for reading, SMTP for sending."""

    def __init__(self, link: AccountLink) -> None:
        """
        Bind to an account

        Args:
            link (AccountLink): account servers
        """
        self.link = link

    def check(self) -> None:
        """
        Verify the IMAP credentials

        Raises:
            MailServerError: when the login fails
        """
        check_login(self.link.incoming)

    def fetch(
        self, mailbox: MailboxKind, cursor: FetchCursor, limit: int
    ) -> FetchBatch:
        """
        Fetch messages above the last stored UID (Sent folder found via LIST)

        Args:
            mailbox (MailboxKind): inbox or sent
            cursor (FetchCursor): what is already stored
            limit (int): maximum messages
        Returns:
            FetchBatch: server folder and messages, oldest first (empty without Sent)
        Raises:
            MailServerError: when the server fails
        """
        with imap_session(self.link.incoming) as connection:
            folder = INBOX if mailbox == "inbox" else find_sent_folder(connection)
            if folder is None:
                return FetchBatch("")
            return FetchBatch(
                folder, fetch_new(connection, folder, cursor.last_uid, limit)
            )

    def set_flag(self, ref: MessageRef, flag: MailFlag, enabled: bool) -> str | None:
        """
        Store \\Seen or \\Flagged on the server

        Args:
            ref (MessageRef): message
            flag (MailFlag): read or flagged
            enabled (bool): new state
        Returns:
            str | None: error message, None on success
        """
        return store_flag(
            self.link.incoming, ref.folder, ref.uid, IMAP_FLAGS[flag], enabled
        )

    def fetch_raw(self, ref: MessageRef) -> bytes:
        """
        Fetch the full raw message by folder and UID

        Args:
            ref (MessageRef): message
        Returns:
            bytes: RFC 822 message
        Raises:
            MailServerError: when the server fails or the message is gone
        """
        return fetch_message(self.link.incoming, ref.folder, ref.uid)

    def send(self, mail: OutgoingMail, reply_to: MessageRef | None) -> None:
        """
        Send over SMTP, then copy into Sent unless the provider files it itself

        Args:
            mail (OutgoingMail): message
            reply_to (MessageRef | None): unused (headers carry the thread)
        Raises:
            MailServerError: when the SMTP server refuses
        """
        message = build_message(mail)
        send_message(self.link.outgoing, message)
        if self.link.incoming.host.lower() not in SELF_FILING_HOSTS:
            append_sent(self.link.incoming, message.as_bytes())


def transport_for(link: AccountLink) -> MailTransport:
    """
    Pick the transport of an account protocol

    Args:
        link (AccountLink): account servers
    Returns:
        MailTransport: transport
    """
    if link.protocol == "ews":
        from controllers.mail.ews_client import EwsTransport

        return EwsTransport(link)
    return ImapTransport(link)

"""Minimal IMAP access: log in, fetch new messages, push read/flag state."""

import imaplib
import logging
import re
import ssl
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass

IMAP_SSL_PORT = 993
TIMEOUT_SECONDS = 30
FETCH_CHUNK = 25
SEEN_FLAG = "\\Seen"
FLAGGED_FLAG = "\\Flagged"

UID_PATTERN = re.compile(rb"UID (\d+)")
FLAGS_PATTERN = re.compile(rb"FLAGS \(([^)]*)\)")
SENT_FLAG = b"\\Sent"
SENT_NAMES = (
    "sent",
    "sent items",
    "sent messages",
    "sent mail",
    "inbox.sent",
    "inbox/sent",
    "[gmail]/sent mail",
)
LIST_PATTERN = re.compile(rb'^\((?P<flags>[^)]*)\) (?:"[^"]*"|NIL) (?P<name>.+)$')

FetchPart = bytes | tuple[bytes, bytes] | None

logger = logging.getLogger(__name__)


class MailServerError(Exception):
    """IMAP or SMTP server refused or could not be reached."""


@dataclass(frozen=True)
class ServerLogin:
    """Host, port and credentials of a mail server."""

    host: str
    port: int
    username: str
    password: str


@dataclass(frozen=True)
class FetchedMail:
    """Raw message and server flags."""

    uid: int
    raw: bytes
    is_read: bool
    is_flagged: bool
    remote_id: str | None = None


def _quote(value: str) -> str:
    """
    Quote a string argument (folder, username) for IMAP commands

    Args:
        value (str): raw value
    Returns:
        str: quoted value, backslashes and quotes escaped
    """
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _connect(login: ServerLogin) -> imaplib.IMAP4:
    """
    Open an IMAP connection (implicit SSL on 993, STARTTLS otherwise)

    Args:
        login (ServerLogin): server
    Returns:
        imaplib.IMAP4: logged-in connection
    """
    context = ssl.create_default_context()
    if login.port == IMAP_SSL_PORT:
        connection: imaplib.IMAP4 = imaplib.IMAP4_SSL(
            login.host, login.port, ssl_context=context, timeout=TIMEOUT_SECONDS
        )
    else:
        connection = imaplib.IMAP4(login.host, login.port, timeout=TIMEOUT_SECONDS)
        connection.starttls(ssl_context=context)
    # imaplib quotes the password but sends the user raw: quote it (spaces, quotes).
    connection.login(_quote(login.username), login.password)
    return connection


@contextmanager
def imap_session(login: ServerLogin) -> Iterator[imaplib.IMAP4]:
    """
    Log in to an IMAP server for the duration of a block

    Args:
        login (ServerLogin): server
    Returns:
        Iterator[imaplib.IMAP4]: logged-in connection
    Raises:
        MailServerError: when the server cannot be reached or refuses the login
    """
    try:
        connection = _connect(login)
    except (imaplib.IMAP4.error, OSError) as error:
        raise MailServerError(f"IMAP {login.host}: {error}") from error
    try:
        yield connection
    except (imaplib.IMAP4.error, OSError) as error:
        raise MailServerError(f"IMAP {login.host}: {error}") from error
    finally:
        try:
            connection.logout()
        except (imaplib.IMAP4.error, OSError) as error:
            logger.debug("IMAP logout failed: %s", error)


def _new_uids(connection: imaplib.IMAP4, last_uid: int, limit: int) -> list[int]:
    """
    List UIDs above last_uid in the selected folder (newest `limit` only)

    Args:
        connection (imaplib.IMAP4): connection with a selected folder
        last_uid (int): highest UID already stored (0 = none)
        limit (int): maximum UIDs returned
    Returns:
        list[int]: ascending UIDs
    """
    criteria = f"UID {last_uid + 1}:*" if last_uid else "ALL"
    _, data = connection.uid("SEARCH", criteria)
    uids = sorted(int(value) for value in (data[0] or b"").split())
    return [uid for uid in uids if uid > last_uid][-limit:]


def parse_fetch(data: Sequence[FetchPart]) -> list[FetchedMail]:
    """
    Read a `UID FETCH (UID FLAGS BODY.PEEK[])` answer

    Args:
        data (Sequence[FetchPart]): imaplib response items
    Returns:
        list[FetchedMail]: messages
    """
    mails: list[FetchedMail] = []
    for item in data:
        if not isinstance(item, tuple):
            continue
        meta, raw = item
        uid_match = UID_PATTERN.search(meta)
        if uid_match is None:
            continue
        flags_match = FLAGS_PATTERN.search(meta)
        flags = flags_match.group(1).decode(errors="replace") if flags_match else ""
        mails.append(
            FetchedMail(
                uid=int(uid_match.group(1)),
                raw=raw,
                is_read=SEEN_FLAG in flags,
                is_flagged=FLAGGED_FLAG in flags,
            )
        )
    return mails


def fetch_new(
    connection: imaplib.IMAP4, folder: str, last_uid: int, limit: int
) -> list[FetchedMail]:
    """
    Fetch messages newer than last_uid without marking them read

    Args:
        connection (imaplib.IMAP4): logged-in connection
        folder (str): folder
        last_uid (int): highest UID already stored
        limit (int): maximum messages fetched
    Returns:
        list[FetchedMail]: messages
    Raises:
        MailServerError: when the folder cannot be opened
    """
    status, _ = connection.select(_quote(folder), readonly=True)
    if status != "OK":
        raise MailServerError(f"Cannot open folder {folder}.")
    uids = _new_uids(connection, last_uid, limit)
    mails: list[FetchedMail] = []
    for start in range(0, len(uids), FETCH_CHUNK):
        chunk = ",".join(str(uid) for uid in uids[start : start + FETCH_CHUNK])
        _, data = connection.uid("FETCH", chunk, "(UID FLAGS BODY.PEEK[])")
        mails.extend(parse_fetch(data))
    return mails


def _list_entries(data: Sequence[FetchPart]) -> list[tuple[bytes, str]]:
    """
    Read a LIST answer into (flags, folder name) pairs (literal names are skipped)

    Args:
        data (Sequence[FetchPart]): imaplib LIST response items
    Returns:
        list[tuple[bytes, str]]: flags and unquoted names
    """
    entries: list[tuple[bytes, str]] = []
    for line in data:
        match = LIST_PATTERN.match(line) if isinstance(line, bytes) else None
        if match is None:
            continue
        name = match.group("name").decode(errors="replace").strip()
        if name.startswith('"') and name.endswith('"'):
            name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        entries.append((match.group("flags"), name))
    return entries


def pick_sent_folder(data: Sequence[FetchPart]) -> str | None:
    """
    Find the Sent folder: special-use \\Sent flag first, then common names

    Args:
        data (Sequence[FetchPart]): imaplib LIST response items
    Returns:
        str | None: folder name, None when there is none
    """
    entries = _list_entries(data)
    flagged = next(
        (name for flags, name in entries if SENT_FLAG in flags.split()), None
    )
    if flagged is not None:
        return flagged
    by_name = {name.lower(): name for _, name in entries}
    return next((by_name[name] for name in SENT_NAMES if name in by_name), None)


def find_sent_folder(connection: imaplib.IMAP4) -> str | None:
    """
    Ask the server for its Sent folder

    Args:
        connection (imaplib.IMAP4): logged-in connection
    Returns:
        str | None: folder name, None when there is none
    """
    _, data = connection.list()
    return pick_sent_folder(data)


def append_sent(login: ServerLogin, raw: bytes) -> str | None:
    """
    Copy a sent message into the Sent folder, marked read (best effort)

    Args:
        login (ServerLogin): IMAP server
        raw (bytes): RFC 822 message
    Returns:
        str | None: error message, None on success
    """
    try:
        with imap_session(login) as connection:
            folder = find_sent_folder(connection)
            if folder is None:
                return "No Sent folder on the server."
            connection.append(_quote(folder), SEEN_FLAG, None, raw)
    except MailServerError as error:
        logger.warning("Copy to Sent failed: %s", error)
        return str(error)
    return None


def store_flag(
    login: ServerLogin, folder: str, uid: int, flag: str, enabled: bool
) -> str | None:
    """
    Set or clear a flag of one message on the server (best effort)

    Args:
        login (ServerLogin): server
        folder (str): folder
        uid (int): message UID
        flag (str): IMAP flag (\\Seen, \\Flagged)
        enabled (bool): set when True, clear otherwise
    Returns:
        str | None: error message, None on success
    """
    try:
        with imap_session(login) as connection:
            connection.select(_quote(folder))
            connection.uid(
                "STORE", str(uid), "+FLAGS" if enabled else "-FLAGS", f"({flag})"
            )
    except MailServerError as error:
        logger.warning("Flag sync failed: %s", error)
        return str(error)
    return None


def fetch_message(login: ServerLogin, folder: str, uid: int) -> bytes:
    """
    Fetch the raw bytes of one message without marking it read

    Args:
        login (ServerLogin): server
        folder (str): folder
        uid (int): message UID
    Returns:
        bytes: RFC 822 message
    Raises:
        MailServerError: when the folder cannot be opened or the message is gone
    """
    with imap_session(login) as connection:
        status, _ = connection.select(_quote(folder), readonly=True)
        if status != "OK":
            raise MailServerError(f"Cannot open folder {folder}.")
        _, data = connection.uid("FETCH", str(uid), "(UID FLAGS BODY.PEEK[])")
    mails = parse_fetch(data)
    if not mails:
        raise MailServerError(f"Message {uid} is no longer in {folder}.")
    return mails[0].raw


def check_login(login: ServerLogin) -> None:
    """
    Verify the IMAP credentials

    Args:
        login (ServerLogin): server
    Raises:
        MailServerError: when the login fails
    """
    with imap_session(login):
        return

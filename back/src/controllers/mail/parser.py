"""Turn raw RFC 822 bytes into a flat, storable message."""

import base64
import html
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email import policy
from email.headerregistry import Address
from email.message import EmailMessage, MIMEPart
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from typing import cast

from controllers.mail.triage import classify_category

SNIPPET_CHARS = 240
MAX_BODY_CHARS = 200_000
MAX_SUBJECT_CHARS = 1_000
MAX_HEADER_CHARS = 500
DEFAULT_ATTACHMENT_NAME = "attachment"
# HTML body size once inline images are embedded as data URIs (column holds 16 MB).
MAX_HTML_WITH_IMAGES_CHARS = 10_000_000
CID_SOURCE = re.compile(r"""(src\s*=\s*["']?)cid:([^"'\s>]+)""", re.IGNORECASE)

HTML_DROP = re.compile(r"<(script|style|head)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
HTML_BREAK = re.compile(r"<\s*(br|/p|/div|/tr|/h\d|/li)[^>]*>", re.IGNORECASE)
HTML_TAG = re.compile(r"<[^>]+>")
BLANK_LINES = re.compile(r"\n\s*\n\s*\n+")
SPACES = re.compile(r"[ \t ]+")


@dataclass
class ParsedMail:
    """Message fields the mail client stores."""

    uid: int
    folder: str
    message_id: str | None
    thread_refs: str | None
    sender_email: str
    sender_name: str
    recipients: str
    cc: str
    subject: str
    date: datetime
    snippet: str
    body_text: str
    body_html: str | None
    category: str
    attachments: list[str] = field(default_factory=list)
    is_read: bool = False
    is_flagged: bool = False
    remote_id: str | None = None
    mailbox: str = "inbox"


class AttachmentNotFoundError(LookupError):
    """The message has no attachment at the requested position."""


@dataclass(frozen=True)
class Attachment:
    """One attached file of a message."""

    filename: str
    content_type: str
    data: bytes


def html_to_text(markup: str) -> str:
    """
    Strip an HTML body down to readable text

    Args:
        markup (str): HTML
    Returns:
        str: plain text
    """
    text = HTML_DROP.sub("", markup)
    text = HTML_BREAK.sub("\n", text)
    text = html.unescape(HTML_TAG.sub("", text))
    lines = [SPACES.sub(" ", line).strip() for line in text.splitlines()]
    return BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def make_snippet(text: str) -> str:
    """
    Build a one-line preview of a body

    Args:
        text (str): plain body
    Returns:
        str: first SNIPPET_CHARS characters, whitespace collapsed
    """
    return " ".join(text.split())[:SNIPPET_CHARS]


def parse_date(value: str | None) -> datetime:
    """
    Parse a Date header into a naive UTC datetime (now when missing or invalid)

    Args:
        value (str | None): header value
    Returns:
        datetime: naive UTC date
    """
    if value:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            parsed = None
        if parsed is not None:
            if parsed.tzinfo is None:
                return parsed
            return parsed.astimezone(UTC).replace(tzinfo=None)
    return datetime.now(UTC).replace(tzinfo=None)


def parse_sender(value: str | None) -> tuple[str, str]:
    """
    Split a From header into (email, display name)

    Args:
        value (str | None): header value
    Returns:
        tuple[str, str]: lowercase email and name (name may be empty)
    """
    pairs = getaddresses([value or ""])
    if not pairs or not pairs[0][1]:
        return "unknown@unknown", ""
    name, address = pairs[0]
    return address.strip().lower()[:MAX_HEADER_CHARS], name.strip()[:MAX_HEADER_CHARS]


def join_addresses(values: list[str]) -> str:
    """
    Normalize address headers into a comma-separated list

    Args:
        values (list[str]): raw header values
    Returns:
        str: "Name <email>, email, …"
    """
    formatted = [
        str(Address(display_name=name, addr_spec=address)) if name else address
        for name, address in getaddresses(values)
        if address
    ]
    return ", ".join(formatted)


def extract_bodies(message: EmailMessage) -> tuple[str, str | None]:
    """
    Pick the text and HTML bodies of a message

    Args:
        message (EmailMessage): parsed message
    Returns:
        tuple[str, str | None]: plain text (derived from HTML when missing) and HTML
    """
    plain_part = message.get_body(preferencelist=("plain",))
    html_part = message.get_body(preferencelist=("html",))
    markup = _part_text(html_part)[:MAX_BODY_CHARS] if html_part is not None else None
    text = _part_text(plain_part) if plain_part is not None else ""
    if not text.strip() and markup:
        text = html_to_text(markup)
    return text[:MAX_BODY_CHARS], embed_inline_images(message, markup) if markup else None


def inline_images(message: EmailMessage) -> dict[str, str]:
    """
    Map the Content-IDs of a message's image parts to data URIs

    Args:
        message (EmailMessage): parsed message
    Returns:
        dict[str, str]: Content-ID (without angle brackets) → data URI
    """
    images: dict[str, str] = {}
    for part in message.walk():
        content_id = str(part.get("Content-ID", "")).strip().strip("<>")
        if not content_id or part.get_content_maintype() != "image":
            continue
        payload = part.get_payload(decode=True)
        if isinstance(payload, bytes):
            encoded = base64.b64encode(payload).decode("ascii")
            images[content_id] = f"data:{part.get_content_type()};base64,{encoded}"
    return images


def embed_inline_images(message: EmailMessage, markup: str) -> str:
    """
    Replace cid: image sources by data URIs, so the sandboxed viewer can show them

    Args:
        message (EmailMessage): parsed message holding the image parts
        markup (str): HTML body
    Returns:
        str: HTML with the images embedded (images over the size budget left as cid:)
    """
    images = inline_images(message)
    if not images:
        return markup
    budget = MAX_HTML_WITH_IMAGES_CHARS - len(markup)

    def replace(match: re.Match[str]) -> str:
        """
        Swap one cid: reference for its data URI when it fits the budget

        Args:
            match (re.Match[str]): src attribute prefix and Content-ID
        Returns:
            str: new attribute text
        """
        nonlocal budget
        data_uri = images.get(match.group(2))
        if data_uri is None or len(data_uri) > budget:
            return match.group(0)
        budget -= len(data_uri)
        return f"{match.group(1)}{data_uri}"

    return CID_SOURCE.sub(replace, markup)


def _part_text(part: MIMEPart) -> str:
    """
    Decode one text part, tolerating bad charsets

    Args:
        part (MIMEPart): MIME part
    Returns:
        str: decoded text
    """
    try:
        return str(part.get_content())
    except (LookupError, UnicodeDecodeError):
        payload = part.get_payload(decode=True)
        return (
            payload.decode("utf-8", errors="replace")
            if isinstance(payload, bytes)
            else ""
        )


def attachment_parts(message: EmailMessage) -> list[EmailMessage]:
    """
    List the attachment parts of a message (their order numbers the attachments)

    Args:
        message (EmailMessage): parsed message
    Returns:
        list[EmailMessage]: attachment parts
    """
    return [
        part for part in message.iter_attachments() if isinstance(part, EmailMessage)
    ]


def attachment_names(message: EmailMessage) -> list[str]:
    """
    List the attachment file names of a message

    Args:
        message (EmailMessage): parsed message
    Returns:
        list[str]: file names
    """
    return [
        part.get_filename() or DEFAULT_ATTACHMENT_NAME
        for part in attachment_parts(message)
    ]


def extract_attachment(raw: bytes, index: int) -> Attachment:
    """
    Extract one attachment of a raw message, by its position in `attachment_names`

    Args:
        raw (bytes): RFC 822 message
        index (int): attachment position, 0 = first
    Returns:
        Attachment: file name, MIME type and decoded content
    Raises:
        AttachmentNotFoundError: when the message has no attachment at that position
    """
    parts = attachment_parts(parse_raw_message(raw))
    if not 0 <= index < len(parts):
        raise AttachmentNotFoundError(f"No attachment #{index} in this message.")
    return _attachment_of(parts[index])


def extract_attachments(raw: bytes) -> list[Attachment]:
    """
    Extract every attachment of a raw message, in `attachment_names` order

    Args:
        raw (bytes): RFC 822 message
    Returns:
        list[Attachment]: files, empty when none
    """
    return [_attachment_of(part) for part in attachment_parts(parse_raw_message(raw))]


def parse_raw_message(raw: bytes) -> EmailMessage:
    """
    Parse a raw message

    Args:
        raw (bytes): RFC 822 message
    Returns:
        EmailMessage: parsed message
    """
    return cast(EmailMessage, BytesParser(policy=policy.default).parsebytes(raw))


def _attachment_of(part: EmailMessage) -> Attachment:
    """
    Decode one attachment part

    Args:
        part (EmailMessage): attachment part
    Returns:
        Attachment: file name, MIME type and decoded content
    """
    payload = part.get_payload(decode=True)
    return Attachment(
        filename=part.get_filename() or DEFAULT_ATTACHMENT_NAME,
        content_type=part.get_content_type(),
        data=payload if isinstance(payload, bytes) else part.as_bytes(),
    )


def parse_message(raw: bytes, uid: int, folder: str) -> ParsedMail:
    """
    Parse raw message bytes fetched from IMAP

    Args:
        raw (bytes): RFC 822 message
        uid (int): IMAP UID
        folder (str): IMAP folder
    Returns:
        ParsedMail: storable message
    """
    message = cast(EmailMessage, BytesParser(policy=policy.default).parsebytes(raw))
    sender_email, sender_name = parse_sender(message.get("From"))
    text, markup = extract_bodies(message)
    headers = {key.lower(): str(value) for key, value in message.items()}
    return ParsedMail(
        uid=uid,
        folder=folder,
        message_id=(_header(message, "Message-ID") or "")[:MAX_HEADER_CHARS] or None,
        thread_refs=_header(message, "References") or _header(message, "In-Reply-To"),
        sender_email=sender_email,
        sender_name=sender_name,
        recipients=join_addresses(message.get_all("To", [])),
        cc=join_addresses(message.get_all("Cc", [])),
        subject=str(message.get("Subject", "")).strip()[:MAX_SUBJECT_CHARS],
        date=parse_date(message.get("Date")),
        snippet=make_snippet(text),
        body_text=text,
        body_html=markup,
        category=classify_category(sender_email, headers),
        attachments=attachment_names(message),
    )


def _header(message: EmailMessage, name: str) -> str | None:
    """
    Read a header as a stripped string

    Args:
        message (EmailMessage): parsed message
        name (str): header name
    Returns:
        str | None: value, None when absent or blank
    """
    value = message.get(name)
    if value is None or not str(value).strip():
        return None
    return str(value).strip()

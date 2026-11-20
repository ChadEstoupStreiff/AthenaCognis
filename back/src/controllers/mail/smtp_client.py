"""Compose and send messages over SMTP."""

import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from controllers.mail.imap_client import MailServerError, ServerLogin
from controllers.mail.inline_images import extract_inline_images

SMTP_SSL_PORT = 465
TIMEOUT_SECONDS = 30
REPLY_PREFIX = "Re:"


@dataclass(frozen=True)
class MailFile:
    """File attached to an outgoing message."""

    filename: str
    content_type: str
    data: bytes


@dataclass(frozen=True)
class OutgoingMail:
    """Message written in the mail client."""

    sender_email: str
    sender_name: str
    to: list[str]
    subject: str
    body: str
    cc: list[str] = field(default_factory=list)
    in_reply_to: str | None = None
    thread_refs: str | None = None
    html_body: str | None = None
    attachments: list[MailFile] = field(default_factory=list)


def reply_subject(subject: str) -> str:
    """
    Prefix a subject with "Re:" once

    Args:
        subject (str): original subject
    Returns:
        str: reply subject
    """
    stripped = subject.strip()
    if stripped.lower().startswith(REPLY_PREFIX.lower()):
        return stripped
    return f"{REPLY_PREFIX} {stripped}"


def build_message(mail: OutgoingMail) -> EmailMessage:
    """
    Build the MIME message, threading headers included

    Args:
        mail (OutgoingMail): message
    Returns:
        EmailMessage: message ready to send
    """
    message = EmailMessage()
    message["From"] = formataddr((mail.sender_name, mail.sender_email))
    message["To"] = ", ".join(mail.to)
    if mail.cc:
        message["Cc"] = ", ".join(mail.cc)
    message["Subject"] = mail.subject
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=mail.sender_email.split("@")[-1])
    if mail.in_reply_to:
        message["In-Reply-To"] = mail.in_reply_to
        message["References"] = " ".join(
            filter(None, [mail.thread_refs, mail.in_reply_to])
        )
    message.set_content(mail.body)
    if mail.html_body is not None:
        add_html(message, mail.html_body, mail.sender_email.split("@")[-1])
    for file in mail.attachments:
        maintype, _, subtype = file.content_type.partition("/")
        message.add_attachment(
            file.data, maintype, subtype or "octet-stream", filename=file.filename
        )
    return message


def add_html(message: EmailMessage, html: str, domain: str) -> None:
    """
    Add the HTML alternative, its data URI images as inline related parts

    Args:
        message (EmailMessage): message holding the plain text body
        html (str): HTML body
        domain (str): sender domain (Content-IDs)
    """
    html, images = extract_inline_images(html, domain)
    message.add_alternative(html, subtype="html")
    if not images:
        return
    html_part = message.get_body(preferencelist=("html",))
    if html_part is None:
        raise ValueError("HTML part missing after add_alternative.")
    for image in images:
        html_part.add_related(
            image.data, "image", image.subtype, cid=f"<{image.content_id}>"
        )


def send_message(login: ServerLogin, message: EmailMessage) -> None:
    """
    Send a message (implicit SSL on 465, STARTTLS otherwise)

    Args:
        login (ServerLogin): SMTP server
        message (EmailMessage): message
    Raises:
        MailServerError: when the server refuses or cannot be reached
    """
    context = ssl.create_default_context()
    try:
        if login.port == SMTP_SSL_PORT:
            with smtplib.SMTP_SSL(
                login.host, login.port, context=context, timeout=TIMEOUT_SECONDS
            ) as server:
                server.login(login.username, login.password)
                server.send_message(message)
            return
        with smtplib.SMTP(login.host, login.port, timeout=TIMEOUT_SECONDS) as server:
            server.starttls(context=context)
            server.login(login.username, login.password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        raise MailServerError(f"SMTP {login.host}: {error}") from error

from email.message import EmailMessage
from typing import ClassVar

import pytest

from controllers.mail import imap_client, transport
from controllers.mail.assistant import (
    AssistantError,
    MailBrief,
    build_reply_prompt,
    parse_insight,
    write_digest,
)
from controllers.mail.imap_client import (
    FetchPart,
    ServerLogin,
    parse_fetch,
    pick_sent_folder,
)
from controllers.mail.parser import (
    AttachmentNotFoundError,
    extract_attachment,
    html_to_text,
    parse_message,
)
from controllers.mail.smtp_client import OutgoingMail, build_message, reply_subject
from controllers.mail.triage import classify_category


def make_raw(headers: dict[str, str], text: str = "", markup: str = "") -> bytes:
    """
    Build raw message bytes

    Args:
        headers (dict[str, str]): headers
        text (str): plain body
        markup (str): HTML body
    Returns:
        bytes: RFC 822 message
    """
    message = EmailMessage()
    for name, value in headers.items():
        message[name] = value
    if text:
        message.set_content(text)
    if markup:
        if text:
            message.add_alternative(markup, subtype="html")
        else:
            message.set_content(markup, subtype="html")
    return message.as_bytes()


BASE_HEADERS = {
    "From": "Alice Martin <Alice@Example.org>",
    "To": "me@example.org, Bob <bob@example.org>",
    "Subject": "Draft review",
    "Date": "Tue, 17 Nov 2026 09:30:00 +0100",
    "Message-ID": "<abc@example.org>",
}


def test_parse_message_reads_headers_and_plain_body() -> None:
    """
    Parse sender, recipients, UTC date and plain body

    Returns:
        None
    """
    mail = parse_message(make_raw(BASE_HEADERS, "Hello,\ncan you review?"), 7, "INBOX")
    assert (mail.sender_email, mail.sender_name) == (
        "alice@example.org",
        "Alice Martin",
    )
    assert mail.recipients == "me@example.org, Bob <bob@example.org>"
    assert mail.date.hour == 8
    assert mail.body_text.startswith("Hello,")
    assert mail.snippet == "Hello, can you review?"
    assert mail.category == "person"
    assert mail.message_id == "<abc@example.org>"


def test_parse_message_derives_text_from_html_only_mail() -> None:
    """
    Fill the text body from HTML when no plain part exists

    Returns:
        None
    """
    markup = (
        "<html><style>p{}</style><body><p>Hi&nbsp;there</p><p>Line 2</p></body></html>"
    )
    mail = parse_message(make_raw(BASE_HEADERS, markup=markup), 1, "INBOX")
    assert mail.body_html is not None
    assert mail.body_text == "Hi there\nLine 2"


def test_html_to_text_drops_scripts() -> None:
    """
    Remove script content and tags

    Returns:
        None
    """
    assert html_to_text("<script>alert(1)</script><b>ok</b>") == "ok"


@pytest.mark.parametrize(
    ("sender", "headers", "expected"),
    [
        ("alice@x.org", {}, "person"),
        ("alice@x.org", {"list-unsubscribe": "<mailto:u@x.org>"}, "newsletter"),
        ("no-reply@github.com", {}, "notification"),
        ("alice@x.org", {"auto-submitted": "auto-generated"}, "notification"),
        ("alice@x.org", {"precedence": "bulk"}, "notification"),
        ("information@x.org", {}, "person"),
    ],
)
def test_classify_category(sender: str, headers: dict[str, str], expected: str) -> None:
    """
    Classify people, newsletters and automated senders

    Args:
        sender (str): address
        headers (dict[str, str]): lowercase headers
        expected (str): category
    Returns:
        None
    """
    assert classify_category(sender, headers) == expected


def test_parse_fetch_reads_uid_and_flags() -> None:
    """
    Read UID, \\Seen and \\Flagged from an IMAP FETCH answer

    Returns:
        None
    """
    data: list[FetchPart] = [
        (b"1 (UID 42 FLAGS (\\Seen \\Flagged) BODY[] {3}", b"raw"),
        b")",
        (b"2 (UID 43 FLAGS () BODY[] {3}", b"two"),
        b")",
    ]
    mails = parse_fetch(data)
    assert [(m.uid, m.is_read, m.is_flagged, m.raw) for m in mails] == [
        (42, True, True, b"raw"),
        (43, False, False, b"two"),
    ]


def test_parse_insight_reads_json_inside_chatter() -> None:
    """
    Extract summary, reply flag and action from a chatty answer

    Returns:
        None
    """
    answer = 'Here:\n{"summary": "Asks for review.", "needs_reply": true, "action": "Review"}'
    insight = parse_insight(answer)
    assert (insight.summary, insight.needs_reply, insight.action) == (
        "Asks for review.",
        True,
        "Review",
    )


@pytest.mark.parametrize("answer", ["nothing", "{bad json}", '{"summary": ""}', "[1]"])
def test_parse_insight_rejects_unusable_answers(answer: str) -> None:
    """
    Fail with AssistantError on unusable answers

    Args:
        answer (str): LLM answer
    Returns:
        None
    """
    with pytest.raises(AssistantError):
        parse_insight(answer)


def test_write_digest_requires_mails() -> None:
    """
    Refuse to brief an empty inbox without calling the LLM

    Returns:
        None
    """
    with pytest.raises(AssistantError):
        write_digest([], lambda prompt: pytest.fail("LLM called"))


def test_reply_prompt_includes_sender_note() -> None:
    """
    Pass the note about the sender and a default instruction

    Returns:
        None
    """
    brief = MailBrief(
        "a@x.org", "Hi", parse_message(make_raw(BASE_HEADERS, "x"), 1, "I").date, "x"
    )
    prompt = build_reply_prompt(brief, "", "My thesis supervisor")
    assert "About the sender: My thesis supervisor" in prompt
    assert "Answer briefly and politely." in prompt


def test_build_reply_message_threads() -> None:
    """
    Set In-Reply-To and References on replies

    Returns:
        None
    """
    outgoing = OutgoingMail(
        "me@x.org",
        "Me",
        ["a@x.org"],
        reply_subject("Re: Hi"),
        "body",
        in_reply_to="<m2@x>",
        thread_refs="<m1@x>",
    )
    message = build_message(outgoing)
    assert message["Subject"] == "Re: Hi"
    assert message["In-Reply-To"] == "<m2@x>"
    assert message["References"] == "<m1@x> <m2@x>"
    assert reply_subject("Hi") == "Re: Hi"


class FakeImap:
    """IMAP4_SSL stand-in recording the LOGIN arguments."""

    logins: ClassVar[list[tuple[str, str]]] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        """
        Accept any connection arguments

        Args:
            args (object): positional arguments
            kwargs (object): keyword arguments
        """

    def login(self, user: str, password: str) -> None:
        """
        Record the login

        Args:
            user (str): user as sent on the wire
            password (str): password (imaplib quotes it itself)
        """
        FakeImap.logins.append((user, password))


def test_connect_quotes_username_with_spaces(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Quote the IMAP username: imaplib quotes only the password, so a username with a
    space was sent as two arguments ("Too many arguments provided" from Gmail)

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    FakeImap.logins = []
    monkeypatch.setattr(imap_client.imaplib, "IMAP4_SSL", FakeImap)
    imap_client._connect(ServerLogin("imap.x.org", 993, 'Chad "C" E', "app pw"))
    assert FakeImap.logins == [('"Chad \\"C\\" E"', "app pw")]


def test_pick_sent_folder_prefers_special_use_flag() -> None:
    """
    Use the \\Sent special-use flag, else a well-known name

    Returns:
        None
    """
    flagged: list[FetchPart] = [
        b'(\\HasNoChildren) "/" "INBOX"',
        b'(\\HasNoChildren \\Sent) "/" "[Gmail]/Messages envoy&AOk-s"',
    ]
    assert pick_sent_folder(flagged) == "[Gmail]/Messages envoy&AOk-s"
    named: list[FetchPart] = [b'(\\HasNoChildren) "." "INBOX.Sent"', b'() "." Drafts']
    assert pick_sent_folder(named) == "INBOX.Sent"
    assert pick_sent_folder([b'() "/" "Archive"']) is None


def test_gmail_send_skips_copy_to_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Copy sent mail into Sent, except on Gmail which files it itself

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    copies: list[str] = []
    monkeypatch.setattr(transport, "send_message", lambda login, message: None)
    monkeypatch.setattr(
        transport, "append_sent", lambda login, raw: copies.append(login.host)
    )
    mail = OutgoingMail("me@x.org", "Me", ["a@x.org"], "Hi", "body")
    for host in ("imap.gmail.com", "imap.fastmail.com"):
        login = ServerLogin(host, 993, "me", "pw")
        transport.ImapTransport(
            transport.AccountLink("imap", "me@x.org", login, login)
        ).send(mail, None)
    assert copies == ["imap.fastmail.com"]


def raw_with_attachments() -> bytes:
    """
    Build a message with a text body and two attachments (one with a non-ASCII name)

    Returns:
        bytes: RFC 822 message
    """
    message = EmailMessage()
    message["From"] = "a@x.org"
    message["Subject"] = "Files"
    message.set_content("See attached")
    message.add_attachment(
        b"%PDF-1.4 data", maintype="application", subtype="pdf", filename="report.pdf"
    )
    message.add_attachment(
        b"\x89PNG data", maintype="image", subtype="png", filename="été.png"
    )
    return message.as_bytes()


def test_extract_attachment_matches_listed_names() -> None:
    """
    Extract an attachment by its position in the stored name list

    Returns:
        None
    """
    raw = raw_with_attachments()
    assert parse_message(raw, 1, "INBOX").attachments == ["report.pdf", "été.png"]
    image = extract_attachment(raw, 1)
    assert (image.filename, image.content_type, image.data) == (
        "été.png",
        "image/png",
        b"\x89PNG data",
    )
    assert extract_attachment(raw, 0).data == b"%PDF-1.4 data"


@pytest.mark.parametrize("index", [2, -1])
def test_extract_attachment_rejects_missing_position(index: int) -> None:
    """
    Refuse a position outside the attachment list

    Args:
        index (int): attachment position
    Returns:
        None
    """
    with pytest.raises(AttachmentNotFoundError):
        extract_attachment(raw_with_attachments(), index)


def related_mail(
    content_id: str = "pic@x.org", shown_id: str = "pic@x.org"
) -> EmailMessage:
    """
    Build an HTML message showing one inline (cid:) GIF

    Args:
        content_id (str): Content-ID of the image part
        shown_id (str): Content-ID referenced by the HTML
    Returns:
        EmailMessage: message
    """
    mail = EmailMessage()
    mail["From"] = "a@x.org"
    mail["Subject"] = "Gif"
    mail.set_content("Look")
    mail.add_alternative(f'<p>Look <img src="cid:{shown_id}"></p>', subtype="html")
    html_part = mail.get_body(preferencelist=("html",))
    assert html_part is not None
    html_part.add_related(b"GIF89a", "image", "gif", cid=f"<{content_id}>")
    return mail


def test_inline_images_are_embedded_for_the_viewer() -> None:
    """
    Turn cid: image sources into data URIs when parsing

    Returns:
        None
    """
    parsed_mail = parse_message(related_mail().as_bytes(), 1, "INBOX")
    assert parsed_mail.body_html is not None
    assert "cid:" not in parsed_mail.body_html
    assert 'src="data:image/gif;base64,R0lGODlh"' in parsed_mail.body_html


def test_unknown_cid_is_left_as_is() -> None:
    """
    Keep a cid: reference that matches no part

    Returns:
        None
    """
    mail = related_mail(shown_id="other@x.org")
    parsed_mail = parse_message(mail.as_bytes(), 1, "INBOX")
    assert parsed_mail.body_html is not None
    assert 'src="cid:other@x.org"' in parsed_mail.body_html

import base64
import smtplib
from collections.abc import Sequence
from types import TracebackType
from typing import TYPE_CHECKING, ClassVar

import pytest

from controllers.mail import smtp_client
from controllers.mail.compose import compose_body, html_to_text
from controllers.mail.imap_client import ServerLogin
from controllers.mail.inline_images import extract_inline_images
from controllers.mail.smtp_client import MailFile, OutgoingMail, build_message

if TYPE_CHECKING:
    from _typeshed import SizedBuffer

STARTTLS_PORT = 587


def test_plain_signature_goes_between_text_and_quote() -> None:
    """
    Put the plain signature below the text and above the quote

    Returns:
        None
    """
    body = compose_body("Hello\n", "Chad <chad@x.org>\nACME", "> original")
    assert body.text == "Hello\n\nChad <chad@x.org>\nACME\n\n> original"
    assert body.html is None


def test_no_signature_keeps_text_and_quote() -> None:
    """
    Join text and quote only when the account has no signature

    Returns:
        None
    """
    assert compose_body("Hi", None, "").text == "Hi"
    assert compose_body("Hi", "  ", "> q").text == "Hi\n\n> q"


def test_html_signature_adds_html_alternative() -> None:
    """
    Render an HTML signature in the HTML part and as text in the plain part

    Returns:
        None
    """
    body = compose_body("a < b", "<p><b>Chad</b></p><p>ACME</p>", "> q")
    assert body.text == "a < b\n\nChad\nACME\n\n> q"
    assert body.html is not None
    assert "a &lt; b" in body.html
    assert "<b>Chad</b>" in body.html
    assert body.html.index("Chad") < body.html.index("&gt; q")


def test_html_to_text_skips_styles() -> None:
    """
    Drop style content and break lines on block tags

    Returns:
        None
    """
    assert html_to_text("<style>p{}</style><div>A</div><br>B") == "A\nB"


def test_smtp_message_carries_html_alternative() -> None:
    """
    Send multipart/alternative when an HTML body exists

    Returns:
        None
    """
    mail = OutgoingMail(
        "me@x.org", "Me", ["a@x.org"], "Hi", "text", html_body="<b>html</b>"
    )
    message = build_message(mail)
    assert message.get_content_type() == "multipart/alternative"
    html_part = message.get_body(preferencelist=("html",))
    assert html_part is not None
    assert "<b>html</b>" in html_part.get_content()


def test_html_part_keeps_line_breaks() -> None:
    """
    Turn written line breaks into <br> so clients ignoring pre-wrap keep them

    Returns:
        None
    """
    body = compose_body("Hello\n\nSecond line", "<p>Chad</p>", "> a\n> b")
    assert body.html is not None
    assert "Hello<br><br>Second line" in body.html
    assert "&gt; a<br>&gt; b" in body.html


def test_formatted_text_goes_in_html_part() -> None:
    """
    Send the formatted text as HTML, the plain signature converted to HTML below it

    Returns:
        None
    """
    body = compose_body("Hi bold", "Chad\nACME", "> q", "Hi <b>bold</b>")
    assert body.text == "Hi bold\n\nChad\nACME\n\n> q"
    assert body.html is not None
    assert "Hi <b>bold</b>" in body.html
    assert "Chad<br>ACME" in body.html
    assert body.html.index("<b>bold</b>") < body.html.index("Chad")


def test_data_uri_image_becomes_inline_part() -> None:
    """
    Replace a data URI image by a cid: reference to a related image part

    Returns:
        None
    """
    payload = base64.b64encode(b"\x89PNG fake").decode()
    html = f'<p>See <img src="data:image/png;base64,{payload}" alt="x"></p>'
    mail = OutgoingMail("me@x.org", "Me", ["a@x.org"], "Hi", "See", html_body=html)
    message = build_message(mail)
    html_part = message.get_body(preferencelist=("html",))
    assert html_part is not None
    content = html_part.get_content()
    assert "data:image" not in content
    images = [part for part in message.walk() if part.get_content_type() == "image/png"]
    assert len(images) == 1
    content_id = str(images[0]["Content-ID"]).strip("<>")
    assert f'src="cid:{content_id}"' in content
    assert images[0].get_content() == b"\x89PNG fake"


def test_invalid_data_uri_is_left_untouched() -> None:
    """
    Keep an undecodable data URI as it is instead of failing the send

    Returns:
        None
    """
    html, images = extract_inline_images(
        '<img src="data:image/png;base64,abc">', "x.org"
    )
    assert images == []
    assert "data:image/png;base64,abc" in html


def test_smtp_message_carries_attachments() -> None:
    """
    Attach files after the body, keeping their name and type

    Returns:
        None
    """
    file = MailFile("report.pdf", "application/pdf", b"%PDF")
    mail = OutgoingMail("me@x.org", "Me", ["a@x.org"], "Hi", "text", attachments=[file])
    message = build_message(mail)
    assert message.get_content_type() == "multipart/mixed"
    parts = list(message.iter_attachments())
    assert [part.get_filename() for part in parts] == ["report.pdf"]
    assert parts[0].get_content() == b"%PDF"


class RecordingSMTP(smtplib.SMTP):
    """SMTP connection recording what would go on the wire (no network)."""

    delivered: ClassVar[list[tuple[list[str], bytes]]] = []

    def __init__(self, host: str, port: int, timeout: float) -> None:
        """
        Skip connecting

        Args:
            host (str): ignored
            port (int): ignored
            timeout (float): ignored
        """
        super().__init__()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """
        Close nothing

        Args:
            exc_type (type[BaseException] | None): ignored
            exc_value (BaseException | None): ignored
            traceback (TracebackType | None): ignored
        """

    def ehlo_or_helo_if_needed(self) -> None:
        """
        Skip the greeting (no server)
        """

    def starttls(self, *args: object, **kwargs: object) -> tuple[int, bytes]:
        """
        Pretend TLS is on

        Args:
            args (object): ignored
            kwargs (object): ignored
        Returns:
            tuple[int, bytes]: success reply
        """
        return 220, b""

    def login(
        self, user: str, password: str, *, initial_response_ok: bool = True
    ) -> tuple[int, bytes]:
        """
        Pretend the login succeeded

        Args:
            user (str): ignored
            password (str): ignored
            initial_response_ok (bool): ignored
        Returns:
            tuple[int, bytes]: success reply
        """
        return 235, b""

    def sendmail(
        self,
        from_addr: str,
        to_addrs: str | Sequence[str],
        msg: "SizedBuffer | str",
        mail_options: Sequence[str] = (),
        rcpt_options: Sequence[str] = (),
    ) -> dict[str, tuple[int, bytes]]:
        """
        Record envelope recipients and message bytes

        Args:
            from_addr (str): ignored
            to_addrs (str | Sequence[str]): envelope recipients
            msg (SizedBuffer | str): message as sent
            mail_options (Sequence[str]): ignored
            rcpt_options (Sequence[str]): ignored
        Returns:
            dict[str, tuple[int, bytes]]: no refused recipient
        """
        recipients = [to_addrs] if isinstance(to_addrs, str) else list(to_addrs)
        raw = msg.encode() if isinstance(msg, str) else bytes(msg)
        RecordingSMTP.delivered.append((recipients, raw))
        return {}


def test_bcc_is_delivered_but_hidden_from_recipients(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Deliver to Bcc addresses without putting them in the bytes sent

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    RecordingSMTP.delivered = []
    monkeypatch.setattr(smtplib, "SMTP", RecordingSMTP)
    mail = OutgoingMail(
        "me@x.org",
        "Me",
        ["a@x.org"],
        "Hi",
        "text",
        cc=["c@x.org"],
        bcc=["hidden@x.org"],
    )
    message = build_message(mail)
    login = ServerLogin("smtp.x.org", STARTTLS_PORT, "me", "secret")
    smtp_client.send_message(login, message)
    [(recipients, raw)] = RecordingSMTP.delivered
    assert sorted(recipients) == ["a@x.org", "c@x.org", "hidden@x.org"]
    assert b"hidden@x.org" not in raw
    assert message["Bcc"] == "hidden@x.org"

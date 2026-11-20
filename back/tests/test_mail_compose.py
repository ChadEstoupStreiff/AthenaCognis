import base64

from controllers.mail.compose import compose_body, html_to_text
from controllers.mail.inline_images import extract_inline_images
from controllers.mail.smtp_client import MailFile, OutgoingMail, build_message


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
    html, images = extract_inline_images('<img src="data:image/png;base64,abc">', "x.org")
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

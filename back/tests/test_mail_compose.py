from controllers.mail.compose import compose_body, html_to_text
from controllers.mail.smtp_client import OutgoingMail, build_message


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

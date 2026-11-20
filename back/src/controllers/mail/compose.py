"""Assemble an outgoing body: written text, account signature, quoted original."""

import re
from dataclasses import dataclass
from html import escape
from html.parser import HTMLParser

PARAGRAPH = "\n\n"
HTML_LINE_BREAK = "<br>"
HTML_TAG = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*(\s[^>]*)?/?>")
BLANK_LINES = re.compile(r"\n{3,}")
LINE_BREAK_TAGS = frozenset({"br", "p", "div", "tr", "li", "h1", "h2", "h3", "table"})
SKIPPED_TAGS = frozenset({"style", "script", "head", "title"})
TEXT_STYLE = "white-space:pre-wrap;font-family:inherit"
QUOTE_STYLE = (
    "white-space:pre-wrap;margin:0;padding-left:8px;border-left:2px solid #ccc"
)


@dataclass(frozen=True)
class ComposedBody:
    """Plain text body and its HTML alternative (None when plain text is enough)."""

    text: str
    html: str | None


class _TextExtractor(HTMLParser):
    """Collect the visible text of an HTML fragment, block tags as line breaks."""

    def __init__(self) -> None:
        """
        Start with no text

        Returns:
            None
        """
        super().__init__()
        self.parts: list[str] = []
        self.skipping = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """
        Break lines on block tags, enter skipped tags

        Args:
            tag (str): tag name
            attrs (list[tuple[str, str | None]]): attributes (unused)
        Returns:
            None
        """
        if tag in SKIPPED_TAGS:
            self.skipping += 1
        elif tag in LINE_BREAK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        """
        Leave skipped tags

        Args:
            tag (str): tag name
        Returns:
            None
        """
        if tag in SKIPPED_TAGS and self.skipping:
            self.skipping -= 1

    def handle_data(self, data: str) -> None:
        """
        Keep text outside skipped tags

        Args:
            data (str): text
        Returns:
            None
        """
        if not self.skipping:
            self.parts.append(data)


def is_html(signature: str) -> bool:
    """
    Tell whether a signature is written in HTML

    Args:
        signature (str): signature
    Returns:
        bool: True when it holds an HTML tag
    """
    return HTML_TAG.search(signature) is not None


def html_to_text(html: str) -> str:
    """
    Convert an HTML fragment to plain text

    Args:
        html (str): HTML
    Returns:
        str: visible text, block tags as line breaks
    """
    extractor = _TextExtractor()
    extractor.feed(html)
    extractor.close()
    lines = [line.strip() for line in "".join(extractor.parts).splitlines()]
    return BLANK_LINES.sub(PARAGRAPH, "\n".join(lines)).strip()


def text_html(text: str, style: str) -> str:
    """
    Wrap plain text in an HTML block keeping its line breaks

    Args:
        text (str): plain text
        style (str): inline CSS
    Returns:
        str: HTML block
    """
    lines = escape(text).replace("\r\n", "\n").replace("\n", HTML_LINE_BREAK)
    return f'<div style="{style}">{lines}</div>'


def compose_text(text: str, signature: str, quote: str) -> str:
    """
    Join text, signature and quote as plain text

    Args:
        text (str): written text
        signature (str): plain text signature, empty = none
        quote (str): quoted original, empty = none
    Returns:
        str: plain text body
    """
    parts = [text.rstrip(), signature, quote]
    return PARAGRAPH.join(part for part in parts if part)


def compose_html(written_html: str, signature_html: str, quote: str) -> str:
    """
    Join written HTML, HTML signature and quote as HTML

    Args:
        written_html (str): written text as HTML
        signature_html (str): signature as HTML, empty = none
        quote (str): quoted original (plain text), empty = none
    Returns:
        str: HTML body
    """
    parts = [f"<div>{written_html}</div>"]
    if signature_html:
        parts.append(f"<div>{signature_html}</div>")
    if quote:
        parts.append(text_html(quote, QUOTE_STYLE))
    return "<br>".join(parts)


def signature_parts(signature: str | None) -> tuple[str, str]:
    """
    Give a signature as plain text and as HTML

    Args:
        signature (str | None): account signature (plain text or HTML), None = none
    Returns:
        tuple[str, str]: plain text and HTML versions, both empty when none
    """
    cleaned = (signature or "").strip()
    if not cleaned:
        return "", ""
    if is_html(cleaned):
        return html_to_text(cleaned), cleaned
    return cleaned, text_html(cleaned, TEXT_STYLE)


def compose_body(
    text: str, signature: str | None, quote: str, written_html: str | None = None
) -> ComposedBody:
    """
    Build the outgoing body: text, then signature, then the quoted original

    Args:
        text (str): written text (plain)
        signature (str | None): account signature (plain text or HTML)
        quote (str): quoted original, empty = none
        written_html (str | None): formatted written text, None = plain only
    Returns:
        ComposedBody: plain text and, for formatted text or an HTML signature,
            an HTML alternative
    """
    signature_text, signature_html = signature_parts(signature)
    plain = compose_text(text, signature_text, quote)
    if written_html is None and not is_html((signature or "").strip()):
        return ComposedBody(plain, None)
    body_html = written_html or text_html(text.rstrip(), TEXT_STYLE)
    return ComposedBody(plain, compose_html(body_html, signature_html, quote))

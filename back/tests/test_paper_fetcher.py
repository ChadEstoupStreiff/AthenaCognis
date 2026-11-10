import io
import urllib.error
import urllib.request
from typing import Dict, List

import pytest

from controllers import PaperFetcher
from controllers.PaperFetcher import (
    FetchError,
    fetch_pdf,
    find_citation_pdf_url,
    is_pdf,
    read_limited,
    validate_url,
)

PDF_BODY = b"%PDF-1.7\n%fake pdf body"
PUBLIC_HOST = "papers.example.org"


class FakeResponse(io.BytesIO):
    """In-memory HTTP response with headers and final URL."""

    def __init__(self, content: bytes, content_type: str, url: str) -> None:
        """
        Build the response

        Args:
            content (bytes): body
            content_type (str): Content-Type header
            url (str): final URL
        Returns:
            None
        """
        super().__init__(content)
        self.headers = {"Content-Type": content_type}
        self.url = url


def fake_opener(pages: Dict[str, FakeResponse], seen: List[str]) -> PaperFetcher.Opener:
    """
    Build an opener answering from a URL → response map

    Args:
        pages (Dict[str, FakeResponse]): responses by URL
        seen (List[str]): requested URLs (filled)
    Returns:
        PaperFetcher.Opener: opener
    """

    def opener(request: urllib.request.Request) -> FakeResponse:
        """
        Answer one request

        Args:
            request (urllib.request.Request): request
        Returns:
            FakeResponse: response
        Raises:
            urllib.error.HTTPError: 404 for unknown URLs
        """
        url = request.full_url
        seen.append(url)
        if url not in pages:
            raise urllib.error.HTTPError(url, 404, "Not Found", None, None)  # type: ignore[arg-type]
        return pages[url]

    return opener


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Resolve the test host as public and everything else normally

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    real = PaperFetcher.is_public_host
    monkeypatch.setattr(
        PaperFetcher, "is_public_host", lambda host: host == PUBLIC_HOST or real(host)
    )


@pytest.mark.parametrize(
    "url",
    [
        "ftp://papers.example.org/a.pdf",
        "file:///etc/passwd",
        "http://127.0.0.1/a.pdf",
        "http://localhost:8400/files/list",
        "http://10.0.0.5/a.pdf",
        "http://[::1]/a.pdf",
        "http:///nohost",
    ],
)
def test_validate_url_rejects_non_public(url: str) -> None:
    """
    Reject non-http and private/loopback URLs

    Args:
        url (str): URL
    Returns:
        None
    """
    with pytest.raises(FetchError) as error:
        validate_url(url)
    assert error.value.status_code == 400


def test_validate_url_accepts_public() -> None:
    """
    Accept a public https URL

    Returns:
        None
    """
    assert (
        validate_url(f"  https://{PUBLIC_HOST}/a.pdf ")
        == f"https://{PUBLIC_HOST}/a.pdf"
    )


def test_is_pdf_detects_signature() -> None:
    """
    Detect the PDF signature, even after leading bytes

    Returns:
        None
    """
    assert is_pdf(PDF_BODY)
    assert is_pdf(b"\n\n" + PDF_BODY)
    assert not is_pdf(b"<html>paywall</html>")


def test_read_limited_rejects_oversize() -> None:
    """
    Fail when the body exceeds the limit

    Returns:
        None
    """
    assert read_limited(io.BytesIO(b"abc"), 3) == b"abc"
    with pytest.raises(FetchError):
        read_limited(io.BytesIO(b"abcd"), 3)


def test_find_citation_pdf_url_both_attribute_orders() -> None:
    """
    Read citation_pdf_url whatever the attribute order, resolving relative links

    Returns:
        None
    """
    base = f"https://{PUBLIC_HOST}/article/1"
    first = '<meta name="citation_pdf_url" content="/pdf/1.pdf?a=1&amp;b=2">'
    second = "<meta content='https://cdn.example.org/1.pdf' name='citation_pdf_url'>"
    assert (
        find_citation_pdf_url(first, base) == f"https://{PUBLIC_HOST}/pdf/1.pdf?a=1&b=2"
    )
    assert find_citation_pdf_url(second, base) == "https://cdn.example.org/1.pdf"
    assert find_citation_pdf_url("<html></html>", base) is None


def test_fetch_pdf_direct() -> None:
    """
    Return a direct PDF as is

    Returns:
        None
    """
    url = f"https://{PUBLIC_HOST}/a.pdf"
    seen: List[str] = []
    pages = {url: FakeResponse(PDF_BODY, "application/pdf", url)}
    assert fetch_pdf(url, fake_opener(pages, seen)) == PDF_BODY
    assert seen == [url]


def test_fetch_pdf_follows_landing_page() -> None:
    """
    Follow the landing page's citation_pdf_url once

    Returns:
        None
    """
    landing = f"https://{PUBLIC_HOST}/article/1"
    pdf = f"https://{PUBLIC_HOST}/pdf/1.pdf"
    page = (
        b'<html><head><meta name="citation_pdf_url" content="/pdf/1.pdf"></head></html>'
    )
    seen: List[str] = []
    pages = {
        landing: FakeResponse(page, "text/html; charset=utf-8", landing),
        pdf: FakeResponse(PDF_BODY, "application/pdf", pdf),
    }
    assert fetch_pdf(landing, fake_opener(pages, seen)) == PDF_BODY
    assert seen == [landing, pdf]


def test_fetch_pdf_paywall_is_unprocessable() -> None:
    """
    Answer 422 when the page holds no PDF

    Returns:
        None
    """
    url = f"https://{PUBLIC_HOST}/article/2"
    pages = {url: FakeResponse(b"<html>Sign in</html>", "text/html", url)}
    with pytest.raises(FetchError) as error:
        fetch_pdf(url, fake_opener(pages, []))
    assert error.value.status_code == 422


def test_fetch_pdf_rejects_private_meta_link() -> None:
    """
    Refuse a citation_pdf_url pointing to a private host

    Returns:
        None
    """
    url = f"https://{PUBLIC_HOST}/article/3"
    page = b'<meta name="citation_pdf_url" content="http://127.0.0.1/secret.pdf">'
    pages = {url: FakeResponse(page, "text/html", url)}
    with pytest.raises(FetchError) as error:
        fetch_pdf(url, fake_opener(pages, []))
    assert error.value.status_code == 400


def test_fetch_pdf_maps_http_errors() -> None:
    """
    Map upstream 404 to 404

    Returns:
        None
    """
    with pytest.raises(FetchError) as error:
        fetch_pdf(f"https://{PUBLIC_HOST}/missing.pdf", fake_opener({}, []))
    assert error.value.status_code == 404

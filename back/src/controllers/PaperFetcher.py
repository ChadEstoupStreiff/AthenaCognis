"""Server-side download of paper PDFs found by the Research search (publishers send no CORS headers)."""

import html
import ipaddress
import logging
import re
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.client import HTTPMessage
from typing import IO, Callable, Optional
from urllib.parse import urljoin, urlparse

MAX_PDF_BYTES = 200 * 1024 * 1024
MAX_PAGE_BYTES = 2 * 1024 * 1024
CHUNK_BYTES = 64 * 1024
TIMEOUT_SECONDS = 60
PDF_MAGIC = b"%PDF-"
PDF_MAGIC_WINDOW = 1024
ALLOWED_SCHEMES = ("http", "https")
USER_AGENT = "Mozilla/5.0 (compatible; AthenaCognis paper import)"
ACCEPT = "application/pdf,text/html;q=0.8,*/*;q=0.5"
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_UNPROCESSABLE = 422
HTTP_BAD_GATEWAY = 502
HTTP_GATEWAY_TIMEOUT = 504
PDF_META_PATTERNS = (
    re.compile(
        r"<meta[^>]+name=[\"']citation_pdf_url[\"'][^>]+content=[\"']([^\"']+)[\"']",
        re.IGNORECASE,
    ),
    re.compile(
        r"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']citation_pdf_url[\"']",
        re.IGNORECASE,
    ),
)

Opener = Callable[[urllib.request.Request], IO[bytes]]

logger = logging.getLogger(__name__)


class FetchError(Exception):
    """Download failure carrying the HTTP status to answer."""

    def __init__(self, message: str, status_code: int) -> None:
        """
        Build the error

        Args:
            message (str): human-readable reason
            status_code (int): HTTP status for the API answer
        Returns:
            None
        """
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class Download:
    """Downloaded body with its declared content type."""

    content: bytes
    content_type: str
    url: str


def is_public_host(host: str) -> bool:
    """
    Check that every address of a host is globally routable

    Args:
        host (str): host name or IP literal
    Returns:
        bool: True when all resolved addresses are public
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    addresses = {info[4][0] for info in infos}
    return bool(addresses) and all(
        ipaddress.ip_address(str(address).split("%")[0]).is_global
        for address in addresses
    )


def validate_url(url: str) -> str:
    """
    Reject URLs that are not public http(s) addresses

    Args:
        url (str): URL to download
    Returns:
        str: the URL, stripped
    Raises:
        FetchError: when the scheme, host or address is not allowed
    """
    cleaned = url.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.hostname:
        raise FetchError("Only http(s) URLs can be imported.", HTTP_BAD_REQUEST)
    if not is_public_host(parsed.hostname):
        raise FetchError(
            f"{parsed.hostname} is not a public address.", HTTP_BAD_REQUEST
        )
    return cleaned


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Redirect handler re-validating every hop (no redirect to private hosts)."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> Optional[urllib.request.Request]:
        """
        Validate the redirect target before following it

        Args:
            req (urllib.request.Request): original request
            fp (IO[bytes]): response body
            code (int): redirect status
            msg (str): status message
            headers (HTTPMessage): response headers
            newurl (str): redirect target
        Returns:
            Optional[urllib.request.Request]: next request
        Raises:
            FetchError: when the target is not allowed
        """
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_opener(request: urllib.request.Request) -> IO[bytes]:
    """
    Open a request with safe redirects and a timeout

    Args:
        request (urllib.request.Request): request
    Returns:
        IO[bytes]: response
    """
    opener = urllib.request.build_opener(SafeRedirectHandler())
    response: IO[bytes] = opener.open(request, timeout=TIMEOUT_SECONDS)
    return response


def read_limited(stream: IO[bytes], max_bytes: int) -> bytes:
    """
    Read a stream, failing past a size limit

    Args:
        stream (IO[bytes]): body
        max_bytes (int): limit
    Returns:
        bytes: body
    Raises:
        FetchError: when the body is larger than the limit
    """
    chunks = []
    total = 0
    while chunk := stream.read(CHUNK_BYTES):
        total += len(chunk)
        if total > max_bytes:
            raise FetchError(
                f"File larger than {max_bytes // (1024 * 1024)} MB.",
                HTTP_UNPROCESSABLE,
            )
        chunks.append(chunk)
    return b"".join(chunks)


def is_pdf(content: bytes) -> bool:
    """
    Check the PDF signature near the start of a body

    Args:
        content (bytes): body
    Returns:
        bool: True when it is a PDF
    """
    return PDF_MAGIC in content[:PDF_MAGIC_WINDOW]


def find_citation_pdf_url(page: str, base_url: str) -> Optional[str]:
    """
    Extract the `citation_pdf_url` meta tag of a landing page

    Args:
        page (str): HTML page
        base_url (str): page URL (for relative links)
    Returns:
        Optional[str]: absolute PDF URL, or None
    """
    for pattern in PDF_META_PATTERNS:
        match = pattern.search(page)
        if match:
            return urljoin(base_url, html.unescape(match.group(1)))
    return None


def download(url: str, opener: Opener, max_bytes: int) -> Download:
    """
    Download one URL

    Args:
        url (str): URL (validated here)
        opener (Opener): HTTP opener
        max_bytes (int): size limit
    Returns:
        Download: body, content type and final URL
    Raises:
        FetchError: on invalid URL, HTTP error, network failure or oversize body
    """
    request = urllib.request.Request(
        validate_url(url), headers={"User-Agent": USER_AGENT, "Accept": ACCEPT}
    )
    try:
        with opener(request) as response:
            content_type = str(getattr(response, "headers", {}).get("Content-Type", ""))
            final_url = str(getattr(response, "url", url) or url)
            return Download(read_limited(response, max_bytes), content_type, final_url)
    except urllib.error.HTTPError as error:
        status = HTTP_NOT_FOUND if error.code == HTTP_NOT_FOUND else HTTP_BAD_GATEWAY
        raise FetchError(f"Source answered {error.code}.", status) from error
    except urllib.error.URLError as error:
        raise FetchError(
            f"Source unreachable: {error.reason}", HTTP_BAD_GATEWAY
        ) from error
    except TimeoutError as error:
        raise FetchError("Source timed out.", HTTP_GATEWAY_TIMEOUT) from error


def fetch_pdf(url: str, opener: Opener = default_opener) -> bytes:
    """
    Download a PDF, following a landing page's `citation_pdf_url` once

    Args:
        url (str): PDF or landing page URL
        opener (Opener): HTTP opener (injected for tests)
    Returns:
        bytes: PDF content
    Raises:
        FetchError: when no PDF can be downloaded
    """
    first = download(url, opener, MAX_PDF_BYTES)
    if is_pdf(first.content):
        return first.content
    linked = None
    if "html" in first.content_type.lower() or first.content.lstrip()[:1] == b"<":
        page = first.content[:MAX_PAGE_BYTES].decode("utf-8", errors="replace")
        linked = find_citation_pdf_url(page, first.url)
    if linked is None:
        raise FetchError(
            "The source returned no PDF (paywall or landing page).", HTTP_UNPROCESSABLE
        )
    logger.info("Following citation_pdf_url %s from %s", linked, url)
    second = download(linked, opener, MAX_PDF_BYTES)
    if not is_pdf(second.content):
        raise FetchError(
            "The source returned no PDF (paywall or landing page).", HTTP_UNPROCESSABLE
        )
    return second.content

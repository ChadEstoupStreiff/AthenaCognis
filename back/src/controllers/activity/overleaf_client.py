"""Overleaf web client: project links, session cookie, history updates, comment threads."""

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

# Overleaf has no public API: these are the JSON endpoints its web editor uses.
DEFAULT_SERVER = "https://www.overleaf.com"
# A generic client name, nothing about the user.
USER_AGENT = "AthenaCognis-activity"
REQUEST_TIMEOUT_SECONDS = 15.0
CACHE_TTL_SECONDS = 120.0
# History is read page by page (newest first) until the window start.
MAX_HISTORY_PAGES = 10
HISTORY_PAGE_MIN_COUNT = 20
MILLISECONDS_PER_SECOND = 1000
# Cookie name used when only the value is pasted: overleaf.com, then self-hosted.
HOSTED_COOKIE = "overleaf_session2"
SELF_HOSTED_COOKIE = "overleaf.sid"
HOSTED_DOMAIN = "overleaf.com"
LOGIN_PATH = "/login"
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
PROJECT_ID = r"[0-9a-f]{24}"
PROJECT_LINK = re.compile(
    rf"^(?:(?:https?://)?[^/\s]+)?/?(?:project/)?(?P<id>{PROJECT_ID})(?:[/?#].*)?$"
)

JsonObject = dict[str, object]
# (url, cookie header, timeout) -> decoded JSON
Fetch = Callable[[str, str, float], object]


class OverleafError(RuntimeError):
    """Overleaf unreachable, session expired, project not found or answer not JSON."""


class SessionExpiredError(OverleafError):
    """Overleaf redirected to its login page: the session cookie is no longer valid."""


def parse_project(link: str) -> str:
    """
    Read a project link

    Args:
        link (str): "https://www.overleaf.com/project/<id>" or the bare 24-character id
    Returns:
        str: project id
    Raises:
        OverleafError: not a project link
    """
    match = PROJECT_LINK.match(link.strip().lower())
    if match is None:
        raise OverleafError(
            f"'{link}' is not an Overleaf project link: "
            "use https://www.overleaf.com/project/<id>."
        )
    return match["id"]


def normalize_server(server: str) -> str:
    """
    Clean the server address (scheme added, trailing slash dropped)

    Args:
        server (str): address as entered, "" for overleaf.com
    Returns:
        str: "https://host[/path]"
    Raises:
        OverleafError: not a web address
    """
    value = server.strip().rstrip("/") or DEFAULT_SERVER
    if "://" not in value:
        value = f"https://{value}"
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise OverleafError(f"'{server}' is not an Overleaf server address.")
    return value


def cookie_header(cookie: str, server: str) -> str:
    """
    Build the Cookie header from what the user pasted

    Args:
        cookie (str): "name=value" (or several), or the bare session value
        server (str): normalized server address
    Returns:
        str: Cookie header, "" when nothing was pasted
    """
    value = cookie.strip().removeprefix("Cookie:").strip()
    if not value or "=" in value:
        return value
    is_hosted = urlsplit(server).netloc.endswith(HOSTED_DOMAIN)
    return f"{HOSTED_COOKIE if is_hosted else SELF_HOSTED_COOKIE}={value}"


def error_message(error: HTTPError) -> str:
    """
    Explain an Overleaf HTTP error

    Args:
        error (HTTPError): error
    Returns:
        str: short reason
    """
    if error.code in (HTTP_UNAUTHORIZED, HTTP_FORBIDDEN):
        return "session expired or no access (paste a fresh session cookie)"
    if error.code == HTTP_NOT_FOUND:
        return "not found, or the session has no access"
    return f"HTTP {error.code}"


def http_json(url: str, cookie: str, timeout: float) -> object:
    """
    GET an Overleaf JSON endpoint

    Args:
        url (str): endpoint URL
        cookie (str): Cookie header
        timeout (float): timeout in seconds
    Returns:
        object: decoded JSON
    Raises:
        SessionExpiredError: redirected to the login page
        OverleafError: HTTP error, network error or invalid JSON
    """
    request = Request(url)
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", USER_AGENT)
    request.add_header("Cookie", cookie)
    try:
        with urlopen(request, timeout=timeout) as response:
            if urlsplit(response.geturl()).path.startswith(LOGIN_PATH):
                raise SessionExpiredError("session expired (paste a fresh cookie)")
            return json.loads(response.read())
    except HTTPError as error:
        raise OverleafError(error_message(error)) from error
    except (OSError, ValueError) as error:
        raise OverleafError(f"Overleaf unreachable: {error}") from error


def milliseconds(moment: datetime) -> int:
    """
    Convert a naive UTC moment to Unix milliseconds

    Args:
        moment (datetime): naive UTC moment
    Returns:
        int: milliseconds since the epoch
    """
    return int(
        (moment - datetime(1970, 1, 1)).total_seconds() * MILLISECONDS_PER_SECOND
    )


def objects(payload: object) -> list[JsonObject]:
    """
    Keep the objects of a JSON list

    Args:
        payload (object): decoded JSON
    Returns:
        list[JsonObject]: objects, empty when the payload is not a list
    """
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


@dataclass(frozen=True)
class HistoryPage:
    """One page of project history and where the next (older) one starts."""

    updates: list[JsonObject]
    next_before: int | None


def history_page(payload: object) -> HistoryPage:
    """
    Read one /updates answer

    Args:
        payload (object): decoded JSON
    Returns:
        HistoryPage: updates and next "before" timestamp (None at the end)
    """
    body = payload if isinstance(payload, dict) else {}
    next_before = body.get("nextBeforeTimestamp")
    return HistoryPage(
        objects(body.get("updates")),
        next_before if isinstance(next_before, int) else None,
    )


@dataclass
class OverleafClient:
    """Cached Overleaf calls with one server and session cookie."""

    server: str
    cookie: str
    fetch: Fetch = http_json
    cache: dict[str, tuple[float, object]] = field(default_factory=dict)

    def get(self, path: str) -> object:
        """
        GET a path, reusing an answer younger than CACHE_TTL_SECONDS

        Args:
            path (str): path below the server (with query)
        Returns:
            object: decoded JSON
        Raises:
            OverleafError: request failed
        """
        now = time.monotonic()
        cached = self.cache.get(path)
        if cached is not None and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
        payload = self.fetch(
            f"{self.server}{path}", self.cookie, REQUEST_TIMEOUT_SECONDS
        )
        self.cache[path] = (now, payload)
        return payload

    def projects(self) -> dict[str, str]:
        """
        Projects the session can open

        Returns:
            dict[str, str]: project id -> name, in Overleaf order
        Raises:
            OverleafError: request failed
        """
        payload = self.get("/user/projects")
        body = payload if isinstance(payload, dict) else {}
        return {
            str(item.get("_id", "")): str(item.get("name", ""))
            for item in objects(body.get("projects"))
            if item.get("_id")
        }

    def me(self) -> JsonObject:
        """
        Account of the session owner

        Returns:
            JsonObject: id, email, first_name, last_name
        Raises:
            OverleafError: request failed
        """
        payload = self.get("/user/personal_info")
        return payload if isinstance(payload, dict) else {}

    def history(self, project: str, since: datetime) -> list[JsonObject]:
        """
        Read the history of a project page by page until updates older than `since`

        Args:
            project (str): project id
            since (datetime): oldest moment needed (naive UTC)
        Returns:
            list[JsonObject]: history updates, newest first
        Raises:
            OverleafError: request failed
        """
        oldest_needed = milliseconds(since)
        query = f"min_count={HISTORY_PAGE_MIN_COUNT}"
        found: list[JsonObject] = []
        for _ in range(MAX_HISTORY_PAGES):
            page = history_page(self.get(f"/project/{project}/updates?{query}"))
            found += page.updates
            if page.next_before is None or page.next_before < oldest_needed:
                break
            query = f"min_count={HISTORY_PAGE_MIN_COUNT}&before={page.next_before}"
        return found

    def threads(self, project: str) -> JsonObject:
        """
        Comment threads of a project

        Args:
            project (str): project id
        Returns:
            JsonObject: thread id -> thread (messages, resolved…)
        Raises:
            OverleafError: request failed
        """
        payload = self.get(f"/project/{project}/threads")
        return payload if isinstance(payload, dict) else {}

    def diff(self, project: str, pathname: str, versions: tuple[int, int]) -> object:
        """
        Text diff of one file between two history versions

        Args:
            project (str): project id
            pathname (str): file path in the project
            versions (tuple[int, int]): from and to versions
        Returns:
            object: decoded JSON ({"diff": [{"u"|"i"|"d": text}, …]})
        Raises:
            OverleafError: request failed
        """
        start, end = versions
        return self.get(
            f"/project/{project}/diff?pathname={quote(pathname)}&from={start}&to={end}"
        )

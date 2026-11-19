"""GitHub REST client: repository / organisation links, events, user repos and orgs."""

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API_ROOT = "https://api.github.com"
API_VERSION = "2022-11-28"
# GitHub requires a User-Agent; a generic client name, nothing about the user.
USER_AGENT = "AthenaCognis-activity"
REQUEST_TIMEOUT_SECONDS = 15.0
CACHE_TTL_SECONDS = 120.0
PER_PAGE = 100
# Events API serves at most 300 events (3 pages of 100).
MAX_EVENT_PAGES = 3
# Suggested repositories per owner (the token owner, then each organisation).
MAX_REPO_SUGGESTIONS = 10
# Most active first: latest push.
ACTIVE_REPOS_QUERY = f"sort=pushed&direction=desc&per_page={MAX_REPO_SUGGESTIONS}"
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
NAME_PATTERN = r"[A-Za-z0-9_.-]+"
REPO_LINK = re.compile(
    rf"^(?:(?:https?://)?(?:www\.)?github\.com[/:]|git@github\.com:)?"
    rf"(?P<owner>{NAME_PATTERN})/(?P<repo>{NAME_PATTERN}?)(?:\.git)?/?(?:[#?].*)?$"
)
ORG_LINK = re.compile(
    rf"^(?:(?:https?://)?(?:www\.)?github\.com/)?(?:orgs/)?(?P<org>{NAME_PATTERN})/?$"
)

JsonObject = dict[str, object]
# (url, token or "", timeout) -> decoded JSON
Fetch = Callable[[str, str, float], object]


class GitHubError(RuntimeError):
    """GitHub unreachable, token rejected, rate limit hit or resource not found."""


def parse_repo(link: str) -> str:
    """
    Read a repository link

    Args:
        link (str): "https://github.com/owner/repo", "owner/repo", "git@github.com:owner/repo.git"…
    Returns:
        str: "owner/repo"
    Raises:
        GitHubError: not a repository link
    """
    match = REPO_LINK.match(link.strip())
    if match is None or not match["repo"]:
        raise GitHubError(
            f"'{link}' is not a GitHub repository link: "
            "use owner/repo or https://github.com/owner/repo."
        )
    return f"{match['owner']}/{match['repo'].removesuffix('.git')}"


def parse_org(link: str) -> str:
    """
    Read an organisation link

    Args:
        link (str): "https://github.com/org", "github.com/orgs/org" or "org"
    Returns:
        str: organisation login
    Raises:
        GitHubError: not an organisation link
    """
    match = ORG_LINK.match(link.strip())
    if match is None:
        raise GitHubError(f"'{link}' is not a GitHub organisation link.")
    return match["org"]


def error_message(error: HTTPError) -> str:
    """
    Explain a GitHub HTTP error

    Args:
        error (HTTPError): error
    Returns:
        str: short reason
    """
    if error.code == HTTP_UNAUTHORIZED:
        return "token rejected"
    if (
        error.code == HTTP_FORBIDDEN
        and error.headers.get("x-ratelimit-remaining") == "0"
    ):
        return "rate limit reached (add a token or wait)"
    if error.code == HTTP_NOT_FOUND:
        return "not found, or the token has no access"
    return f"HTTP {error.code}"


def http_json(url: str, token: str, timeout: float) -> object:
    """
    GET a GitHub API URL

    Args:
        url (str): API URL
        token (str): personal access token, "" for anonymous
        timeout (float): timeout in seconds
    Returns:
        object: decoded JSON
    Raises:
        GitHubError: HTTP error, network error or invalid JSON
    """
    request = Request(url)
    request.add_header("Accept", "application/vnd.github+json")
    request.add_header("X-GitHub-Api-Version", API_VERSION)
    request.add_header("User-Agent", USER_AGENT)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except HTTPError as error:
        raise GitHubError(error_message(error)) from error
    except (OSError, ValueError) as error:
        raise GitHubError(f"GitHub unreachable: {error}") from error


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


@dataclass
class GitHubClient:
    """Cached GitHub calls with one token."""

    token: str
    fetch: Fetch = http_json
    cache: dict[str, tuple[float, object]] = field(default_factory=dict)

    def get(self, path: str) -> object:
        """
        GET an API path, reusing an answer younger than CACHE_TTL_SECONDS

        Args:
            path (str): path below API_ROOT (with query)
        Returns:
            object: decoded JSON
        Raises:
            GitHubError: request failed
        """
        key = f"{bool(self.token)}:{path}"
        now = time.monotonic()
        cached = self.cache.get(key)
        if cached is not None and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
        payload = self.fetch(f"{API_ROOT}{path}", self.token, REQUEST_TIMEOUT_SECONDS)
        self.cache[key] = (now, payload)
        return payload

    def events(self, path: str, since: datetime) -> list[JsonObject]:
        """
        Read an events feed page by page until events older than `since`

        Args:
            path (str): events path (e.g. "/repos/o/r/events")
            since (datetime): oldest moment needed (naive UTC)
        Returns:
            list[JsonObject]: events, newest first
        Raises:
            GitHubError: request failed
        """
        found: list[JsonObject] = []
        for page in range(1, MAX_EVENT_PAGES + 1):
            batch = objects(self.get(f"{path}?per_page={PER_PAGE}&page={page}"))
            found += batch
            oldest = str(batch[-1].get("created_at", "")) if batch else ""
            if len(batch) < PER_PAGE or oldest < f"{since:%Y-%m-%dT%H:%M:%S}":
                break
        return found

    def login(self) -> str:
        """
        Login of the token owner

        Returns:
            str: login, "" without token
        Raises:
            GitHubError: request failed
        """
        if not self.token:
            return ""
        payload = self.get("/user")
        return str(payload.get("login", "")) if isinstance(payload, dict) else ""

    def repo_names(self, path: str) -> list[str]:
        """
        Full names of a repository listing

        Args:
            path (str): listing path with query
        Returns:
            list[str]: "owner/repo", empty without token
        Raises:
            GitHubError: request failed
        """
        if not self.token:
            return []
        return [str(item.get("full_name", "")) for item in objects(self.get(path))]

    def user_repos(self) -> list[str]:
        """
        Most active repositories the token owner owns

        Returns:
            list[str]: "owner/repo", at most MAX_REPO_SUGGESTIONS, empty without token
        Raises:
            GitHubError: request failed
        """
        return self.repo_names(f"/user/repos?affiliation=owner&{ACTIVE_REPOS_QUERY}")

    def org_repos(self, org: str) -> list[str]:
        """
        Most active repositories of an organisation

        Args:
            org (str): organisation login
        Returns:
            list[str]: "owner/repo", at most MAX_REPO_SUGGESTIONS, empty without token
        Raises:
            GitHubError: request failed
        """
        return self.repo_names(f"/orgs/{org}/repos?{ACTIVE_REPOS_QUERY}")

    def orgs(self) -> list[str]:
        """
        Organisations of the token owner

        Returns:
            list[str]: logins, empty without token
        Raises:
            GitHubError: request failed
        """
        if not self.token:
            return []
        return [
            str(item.get("login", ""))
            for item in objects(self.get(f"/user/orgs?per_page={PER_PAGE}"))
        ]

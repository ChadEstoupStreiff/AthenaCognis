"""ActivityWatch REST client: bucket list and per-period usage queries."""

import ipaddress
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

API_PREFIX = "/api/0"
ALLOWED_SCHEMES = ("http", "https")
JSON_HEADERS = {"Content-Type": "application/json"}
# aw-server rejects any Host header but localhost (DNS rebinding guard).
LOCAL_HOST_HEADER = "localhost"
DOCKER_HOST_ALIASES = frozenset({"host.docker.internal", "gateway.docker.internal"})
DEFAULT_PORTS = {"http": 80, "https": 443}
WINDOW_TYPE = "currentwindow"
AFK_TYPE = "afkstatus"
WEB_TYPE = "web.tab.current"
NOT_AFK = "not-afk"
APP_KEY = "app"
DOMAIN_KEY = "$domain"
TITLE_KEY = "title"

# (url, JSON body or None for GET, timeout in seconds) -> decoded JSON
Fetch = Callable[[str, bytes | None, float], object]
Slot = tuple[datetime, datetime]


class ActivityWatchError(RuntimeError):
    """Server unreachable, bad URL or unexpected answer."""


def check_url(url: str) -> str:
    """
    Check that a URL is http(s) with a host

    Args:
        url (str): URL
    Returns:
        str: same URL, trimmed of surrounding spaces
    Raises:
        ActivityWatchError: not an http(s) URL with a host
    """
    trimmed = url.strip()
    parts = urlsplit(trimmed)
    if parts.scheme not in ALLOWED_SCHEMES or not parts.netloc:
        raise ActivityWatchError(f"Invalid ActivityWatch URL '{url}'.")
    return trimmed


def validate_url(url: str) -> str:
    """
    Check a server URL and strip its trailing slash

    Args:
        url (str): server URL (e.g. "http://localhost:5600")
    Returns:
        str: URL without trailing slash
    Raises:
        ActivityWatchError: not an http(s) URL with a host
    """
    return check_url(url).rstrip("/")


def is_ip_address(host: str) -> bool:
    """
    Tell whether a host is a literal IP address

    Args:
        host (str): host name or address
    Returns:
        bool: True for an IPv4 or IPv6 address
    """
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def host_header(url: str) -> str | None:
    """
    Host header making aw-server accept a request sent to a Docker host alias or an IP

    Args:
        url (str): request URL
    Returns:
        str | None: "localhost:<port>", None to keep the URL host (domain names, proxies)
    """
    parts = urlsplit(url)
    host = parts.hostname or ""
    if host not in DOCKER_HOST_ALIASES and not is_ip_address(host):
        return None
    port = parts.port or DEFAULT_PORTS.get(parts.scheme, DEFAULT_PORTS["http"])
    return f"{LOCAL_HOST_HEADER}:{port}"


def http_json(url: str, body: bytes | None, timeout: float) -> object:
    """
    Send a GET (no body) or JSON POST request and decode the JSON answer

    Args:
        url (str): full http(s) URL
        body (bytes | None): JSON body, None for GET
        timeout (float): timeout in seconds
    Returns:
        object: decoded JSON
    Raises:
        ActivityWatchError: network error, HTTP error or invalid JSON
    """
    method = "GET" if body is None else "POST"
    headers = dict(JSON_HEADERS)
    host = host_header(url)
    if host is not None:
        headers["Host"] = host
    request = Request(check_url(url), data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except (OSError, ValueError) as error:
        raise ActivityWatchError(f"ActivityWatch request failed: {error}") from error


@dataclass(frozen=True)
class Bucket:
    """One ActivityWatch bucket (data of one watcher on one device)."""

    id: str
    type: str
    hostname: str


@dataclass(frozen=True)
class MergedEvent:
    """Events merged by keys: total duration and the shared key values."""

    seconds: float
    data: dict[str, str]


def parse_buckets(payload: object) -> list[Bucket]:
    """
    Read the answer of GET /buckets/

    Args:
        payload (object): decoded JSON, {bucket_id: {type, hostname, ...}}
    Returns:
        list[Bucket]: buckets
    Raises:
        ActivityWatchError: answer is not an object
    """
    if not isinstance(payload, dict):
        raise ActivityWatchError("Unexpected ActivityWatch bucket list.")
    return [
        Bucket(str(key), str(raw.get("type", "")), str(raw.get("hostname", "")))
        for key, raw in payload.items()
        if isinstance(raw, dict)
    ]


def parse_event(raw: object) -> MergedEvent | None:
    """
    Read one merged event

    Args:
        raw (object): decoded JSON event {duration, data, ...}
    Returns:
        MergedEvent | None: event, None when malformed
    """
    if not isinstance(raw, dict):
        return None
    duration = raw.get("duration")
    data = raw.get("data")
    if not isinstance(duration, int | float) or not isinstance(data, dict):
        return None
    return MergedEvent(float(duration), {str(k): str(v) for k, v in data.items()})


def parse_periods(payload: object, count: int) -> list[list[MergedEvent]]:
    """
    Read the answer of POST /query/: one event list per time period

    Args:
        payload (object): decoded JSON
        count (int): number of periods sent
    Returns:
        list[list[MergedEvent]]: events per period, in period order
    Raises:
        ActivityWatchError: not one list per period
    """
    if not isinstance(payload, list) or len(payload) != count:
        raise ActivityWatchError("Unexpected ActivityWatch query result.")
    periods: list[list[MergedEvent]] = []
    for raw_events in payload:
        events = raw_events if isinstance(raw_events, list) else []
        periods.append([item for item in map(parse_event, events) if item is not None])
    return periods


def time_slots(start: datetime, end: datetime, step: timedelta) -> list[Slot]:
    """
    Cut a window into consecutive slots, the last one clipped to the end

    Args:
        start (datetime): window start (naive UTC)
        end (datetime): window end, excluded
        step (timedelta): slot length
    Returns:
        list[Slot]: [start, end) slots
    """
    slots: list[Slot] = []
    cursor = start
    while cursor < end:
        slots.append((cursor, min(cursor + step, end)))
        cursor += step
    return slots


def period_text(slot: Slot) -> str:
    """
    Format a slot as an ActivityWatch time period

    Args:
        slot (Slot): naive UTC [start, end)
    Returns:
        str: "<iso start>/<iso end>" with UTC offset
    """
    start, end = (moment.replace(tzinfo=UTC).isoformat() for moment in slot)
    return f"{start}/{end}"


def usage_query(bucket_id: str, afk_bucket_id: str | None, is_web: bool) -> list[str]:
    """
    Build the query merging a bucket's events by app (or domain) and title

    Args:
        bucket_id (str): window or browser bucket
        afk_bucket_id (str | None): AFK bucket to keep only time at the keyboard, None to keep all
        is_web (bool): browser bucket (group by domain instead of app)
    Returns:
        list[str]: query lines
    """
    lines = [f"events = flood(query_bucket({json.dumps(bucket_id)}));"]
    if afk_bucket_id is not None:
        lines += [
            f"afk = flood(query_bucket({json.dumps(afk_bucket_id)}));",
            f'afk = filter_keyvals(afk, "status", ["{NOT_AFK}"]);',
            "events = filter_period_intersect(events, afk);",
        ]
    if is_web:
        lines.append("events = split_url_events(events);")
    key = DOMAIN_KEY if is_web else APP_KEY
    lines.append(f'RETURN = merge_events_by_keys(events, ["{key}", "{TITLE_KEY}"]);')
    return lines


@dataclass(frozen=True)
class ActivityWatchClient:
    """Calls of one ActivityWatch server."""

    base_url: str
    fetch: Fetch
    timeout: float

    def buckets(self) -> list[Bucket]:
        """
        List the buckets of the server

        Returns:
            list[Bucket]: buckets
        Raises:
            ActivityWatchError: server unreachable or bad answer
        """
        payload = self.fetch(
            f"{self.base_url}{API_PREFIX}/buckets/", None, self.timeout
        )
        return parse_buckets(payload)

    def query(
        self, slots: Sequence[Slot], lines: Sequence[str]
    ) -> list[list[MergedEvent]]:
        """
        Run a query on each slot

        Args:
            slots (Sequence[Slot]): time periods
            lines (Sequence[str]): query lines (see usage_query)
        Returns:
            list[list[MergedEvent]]: result per slot
        Raises:
            ActivityWatchError: server unreachable or bad answer
        """
        if not slots:
            return []
        body = json.dumps(
            {"timeperiods": [period_text(slot) for slot in slots], "query": list(lines)}
        ).encode()
        payload = self.fetch(f"{self.base_url}{API_PREFIX}/query/", body, self.timeout)
        return parse_periods(payload, len(slots))

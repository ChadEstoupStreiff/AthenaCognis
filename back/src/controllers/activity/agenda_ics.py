"""ICS calendar links: download (webcal, basic auth) and events of a window."""

import base64
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from urllib.parse import unquote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import recurring_ical_events
from icalendar import Calendar, Event

from controllers.activity.base import TimeRange, to_naive_utc

ALLOWED_SCHEMES = ("http", "https")
WEBCAL_SCHEMES = {"webcal": "https", "webcals": "https"}
MAX_ICS_BYTES = 20 * 1024 * 1024
# All-day events have no time zone: placed at noon UTC, inside the local day for
# any offset up to ±12 h. Recurrences are expanded with one day of margin for them.
ALL_DAY_HOUR = timedelta(hours=12)
EXPAND_MARGIN = timedelta(days=1)
CANCELLED = "CANCELLED"
NO_TITLE = "(no title)"
MAILTO = "mailto:"

# (url, timeout in seconds) -> raw ICS bytes
FetchIcs = Callable[[str, float], bytes]


class CalendarError(RuntimeError):
    """Link unreachable, invalid or not an ICS calendar."""


@dataclass(frozen=True)
class CalendarLink:
    """Calendar URL split into a plain http(s) URL and optional basic-auth header."""

    url: str
    authorization: str | None
    host: str


def parse_link(link: str) -> CalendarLink:
    """
    Normalize a calendar link: webcal -> https, user:password@ -> basic auth

    Args:
        link (str): ICS link as pasted
    Returns:
        CalendarLink: request URL and credentials
    Raises:
        CalendarError: not an http(s) or webcal URL with a host
    """
    parts = urlsplit(link.strip())
    scheme = WEBCAL_SCHEMES.get(parts.scheme.lower(), parts.scheme.lower())
    if scheme not in ALLOWED_SCHEMES or not parts.hostname:
        raise CalendarError("Calendar link must be an http(s) or webcal URL.")
    netloc = parts.hostname if parts.port is None else f"{parts.hostname}:{parts.port}"
    authorization = None
    if parts.username is not None:
        pair = f"{unquote(parts.username)}:{unquote(parts.password or '')}"
        authorization = f"Basic {base64.b64encode(pair.encode()).decode()}"
    url = urlunsplit((scheme, netloc, parts.path, parts.query, ""))
    return CalendarLink(url, authorization, parts.hostname)


def http_ics(link: str, timeout: float) -> bytes:
    """
    Download a calendar

    Args:
        link (str): ICS link (see parse_link)
        timeout (float): timeout in seconds
    Returns:
        bytes: ICS content
    Raises:
        CalendarError: bad link, network or HTTP error, or file over MAX_ICS_BYTES
    """
    target = parse_link(link)
    request = Request(target.url)
    if target.authorization is not None:
        request.add_header("Authorization", target.authorization)
    try:
        with urlopen(request, timeout=timeout) as response:
            data: bytes = response.read(MAX_ICS_BYTES + 1)
    except (OSError, ValueError) as error:
        raise CalendarError(f"{target.host}: {error}") from error
    if len(data) > MAX_ICS_BYTES:
        raise CalendarError(
            f"{target.host}: calendar larger than {MAX_ICS_BYTES} bytes"
        )
    return data


@dataclass(frozen=True)
class CalendarEvent:
    """One occurrence of a calendar event, times in naive UTC."""

    uid: str
    title: str
    start: datetime
    duration: timedelta
    is_all_day: bool
    calendar: str
    status: str = ""
    location: str = ""
    description: str = ""
    attendees: tuple[str, ...] = ()


def attendee_names(component: Event) -> tuple[str, ...]:
    """
    Names of the attendees (CN, else address)

    Args:
        component (Event): event
    Returns:
        tuple[str, ...]: names
    """
    raw = component.get("attendee")
    if raw is None:
        return ()
    items = raw if isinstance(raw, list) else [raw]
    names = [
        str(item.params.get("CN") or "") or str(item).removeprefix(MAILTO)
        for item in items
    ]
    return tuple(name for name in names if name)


def event_times(component: Event) -> tuple[datetime, timedelta, bool]:
    """
    Start, duration and all-day flag of an occurrence

    Args:
        component (Event): occurrence (recurrences already expanded)
    Returns:
        tuple[datetime, timedelta, bool]: naive UTC start, duration, all-day
    """
    start = component.decoded("dtstart")
    if "dtend" in component:
        duration = component.decoded("dtend") - start
    elif "duration" in component:
        duration = component.decoded("duration")
    else:
        duration = timedelta()
    if isinstance(start, datetime):
        return to_naive_utc(start), duration, False
    day: date = start
    return datetime(day.year, day.month, day.day) + ALL_DAY_HOUR, duration, True


def to_event(component: Event, calendar: str) -> CalendarEvent:
    """
    Convert an occurrence

    Args:
        component (Event): occurrence
        calendar (str): calendar name
    Returns:
        CalendarEvent: event
    """
    start, duration, is_all_day = event_times(component)
    return CalendarEvent(
        uid=str(component.get("uid", "")),
        title=str(component.get("summary", "")).strip() or NO_TITLE,
        start=start,
        duration=duration,
        is_all_day=is_all_day,
        calendar=calendar,
        status=str(component.get("status", "")).upper(),
        location=str(component.get("location", "")),
        description=str(component.get("description", "")),
        attendees=attendee_names(component),
    )


def calendar_events(data: bytes, window: TimeRange) -> list[CalendarEvent]:
    """
    Expand the events of an ICS file over a window, cancelled ones left out

    Args:
        data (bytes): ICS content
        window (TimeRange): time window
    Returns:
        list[CalendarEvent]: occurrences touching the window (with margin)
    Raises:
        CalendarError: content is not a valid calendar
    """
    start = (window.start - EXPAND_MARGIN).replace(tzinfo=UTC)
    end = (window.end + EXPAND_MARGIN).replace(tzinfo=UTC)
    try:
        calendar = Calendar.from_ical(data)
        components = recurring_ical_events.of(calendar).between(start, end)
    except ValueError as error:
        raise CalendarError(f"Invalid calendar: {error}") from error
    name = str(calendar.get("x-wr-calname", ""))
    events = [to_event(component, name) for component in components]
    return [event for event in events if event.status != CANCELLED]

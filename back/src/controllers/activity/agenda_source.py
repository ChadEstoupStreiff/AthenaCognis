"""Agenda data source: events of Google, iCloud and other ICS calendar links."""

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from controllers.activity.agenda_ics import (
    CalendarError,
    CalendarEvent,
    FetchIcs,
    calendar_events,
    http_ics,
    parse_link,
)
from controllers.activity.base import (
    PEOPLE_CONTENT,
    SUMMARY_CONTENT,
    Activity,
    ContentField,
    DataSource,
    SourceDescriptor,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.common import excerpt
from controllers.activity.config import ConfigField, SourceConfig

AGENDA_DESCRIPTOR = SourceDescriptor(
    "agenda",
    "Agenda",
    "pi pi-calendar",
    "Events from Google, iCloud or any ICS calendar link.",
)
FETCH_TIMEOUT_SECONDS = 15.0
CACHE_TTL_SECONDS = 300.0
SECONDS_PER_MINUTE = 60
MINUTES_PER_HOUR = 60
EVENT_KIND = "event"
ALL_DAY_KIND = "all_day"
TENTATIVE = "TENTATIVE"
ONE_DAY = timedelta(days=1)

AGENDA_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Event description"),
    ContentField(PEOPLE_CONTENT, "Attendees"),
    ContentField("duration", "Duration"),
    ContentField("provider", "Provider", default=False),
    ContentField("calendar", "Calendar"),
    ContentField("status", "Status"),
    ContentField("location", "Location"),
]


@dataclass(frozen=True)
class Provider:
    """One connector: setting name, label and where to find the link."""

    name: str
    label: str
    hint: str


PROVIDERS: tuple[Provider, ...] = (
    Provider(
        "google",
        "Google Calendar links",
        "Calendar settings → Integrate calendar → Secret address in iCal format. "
        "One per line.",
    ),
    Provider(
        "icloud",
        "iCloud Calendar links",
        "Calendar app → share the calendar → Public calendar → copy the webcal:// "
        "link. One per line.",
    ),
    Provider(
        "custom",
        "Other calendar links",
        "Any ICS or webcal URL (e.g. Nextcloud); login as "
        "https://user:password@host/…. One per line.",
    ),
)


def duration_text(duration: timedelta, is_all_day: bool) -> str:
    """
    Format an event duration

    Args:
        duration (timedelta): duration
        is_all_day (bool): all-day event (counted in days)
    Returns:
        str: "N day(s)", "H h M min", "H h" or "M min"
    """
    if is_all_day:
        days = max(1, duration.days)
        return f"{days} day{'s' if days != 1 else ''}"
    hours, minutes = divmod(
        int(duration.total_seconds()) // SECONDS_PER_MINUTE, MINUTES_PER_HOUR
    )
    if hours and minutes:
        return f"{hours} h {minutes} min"
    return f"{hours} h" if hours else f"{minutes} min"


def event_details(
    event: CalendarEvent, provider: Provider, share_people: bool
) -> dict[str, str]:
    """
    Facts of an event useful to a day summary

    Args:
        event (CalendarEvent): event
        provider (Provider): connector of its link
        share_people (bool): include the location
    Returns:
        dict[str, str]: details
    """
    details = {
        "duration": duration_text(event.duration, event.is_all_day),
        "provider": provider.name,
    }
    if event.calendar:
        details["calendar"] = event.calendar
    if event.status == TENTATIVE:
        details["status"] = "tentative"
    if share_people and event.location:
        details["location"] = event.location
    return details


def covers_day(event: CalendarEvent, day: date) -> bool:
    """
    Tell whether an all-day event spans a day

    Args:
        event (CalendarEvent): occurrence
        day (date): day
    Returns:
        bool: True for an all-day event whose days include the day
    """
    if not event.is_all_day:
        return False
    last = event.start.date() + max(event.duration - ONE_DAY, timedelta())
    return event.start.date() <= day <= last


def event_activity(
    event: CalendarEvent, provider: Provider, share_people: bool
) -> Activity:
    """
    Build the activity of one event occurrence

    Args:
        event (CalendarEvent): occurrence
        provider (Provider): connector of its link
        share_people (bool): include attendees, location and description
    Returns:
        Activity: normalized activity
    """
    return Activity(
        id=f"agenda:{provider.name}:{event.uid}:{event.start:%Y%m%dT%H%M}",
        source=AGENDA_DESCRIPTOR.key,
        kind=ALL_DAY_KIND if event.is_all_day else EVENT_KIND,
        occurred_at=event.start,
        title=event.title,
        summary=excerpt(event.description) if share_people else "",
        actors=event.attendees if share_people else (),
        details=event_details(event, provider, share_people),
    )


class AgendaDataSource(DataSource):
    """Calendar events read from ICS links, cached a few minutes per link."""

    descriptor = AGENDA_DESCRIPTOR
    fetch: FetchIcs = staticmethod(http_ics)

    def __init__(self) -> None:
        """
        Start with an empty download cache

        Returns:
            None
        """
        self._cache: dict[str, tuple[float, bytes]] = {}

    def links(self, config: SourceConfig) -> list[tuple[Provider, str]]:
        """
        Every configured link with its connector

        Args:
            config (SourceConfig): agenda settings
        Returns:
            list[tuple[Provider, str]]: (provider, link) pairs
        """
        return [
            (provider, link)
            for provider in PROVIDERS
            for link in config.lines(provider.name)
        ]

    def is_configured(self) -> bool:
        """
        Links are entered on the Activity page itself

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Count the linked calendars

        Returns:
            str: "N calendar(s)" or "No calendar linked"
        """
        count = len(self.links(self.config()))
        if count == 0:
            return "No calendar linked"
        return f"{count} calendar{'s' if count != 1 else ''}"

    def content_fields(self) -> list[ContentField]:
        """
        Content a calendar event activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return AGENDA_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare one links field per connector, all-day and privacy settings

        Returns:
            list[ConfigField]: fields
        """
        links = [
            ConfigField(
                provider.name, provider.label, provider.hint, "lines", "", secret=True
            )
            for provider in PROVIDERS
        ]
        return [
            *links,
            ConfigField(
                "skip_all_day",
                "Skip all-day events",
                "Leave out holidays, birthdays and day-long blocks.",
                "toggle",
                False,
            ),
            ConfigField(
                "share_people",
                "Share attendees, location and notes with AI",
                "Off: only titles, times and durations.",
                "toggle",
                True,
            ),
        ]

    def download(self, link: str) -> bytes:
        """
        Download a calendar, reusing a copy younger than CACHE_TTL_SECONDS

        Args:
            link (str): ICS link
        Returns:
            bytes: ICS content
        Raises:
            CalendarError: download failed
        """
        now = time.monotonic()
        cached = self._cache.get(link)
        if cached is not None and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
        data = self.fetch(link, FETCH_TIMEOUT_SECONDS)
        self._cache[link] = (now, data)
        return data

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the events of every linked calendar in the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per occurrence
        Raises:
            SourceUnavailableError: a calendar could not be read (message names its host)
        """
        config = self.config()
        share_people = config.flag("share_people")
        skip_all_day = config.flag("skip_all_day")
        activities: list[Activity] = []
        for provider, link in self.track(
            self.links(config), "Reading calendars", "calendars"
        ):
            try:
                events = calendar_events(self.download(link), window)
            except CalendarError as error:
                raise SourceUnavailableError(
                    f"{provider.label} ({self._host(link)}): {error}"
                ) from error
            activities += [
                event_activity(event, provider, share_people)
                for event in events
                if not (skip_all_day and event.is_all_day)
            ]
        return activities

    def all_day_titles(self, day: date) -> tuple[str, ...]:
        """
        Titles of the all-day events spanning a day, in every linked calendar

        Args:
            day (date): day
        Returns:
            tuple[str, ...]: titles
        Raises:
            SourceUnavailableError: a calendar could not be read (message names its host)
        """
        midnight = datetime(day.year, day.month, day.day)
        window = TimeRange(midnight - ONE_DAY, midnight + 2 * ONE_DAY)
        titles: list[str] = []
        for provider, link in self.links(self.config()):
            try:
                events = calendar_events(self.download(link), window)
            except CalendarError as error:
                raise SourceUnavailableError(
                    f"{provider.label} ({self._host(link)}): {error}"
                ) from error
            titles += [event.title for event in events if covers_day(event, day)]
        return tuple(titles)

    def _host(self, link: str) -> str:
        """
        Host of a link for messages (the path of a secret link stays hidden)

        Args:
            link (str): ICS link
        Returns:
            str: host, "invalid link" when unparseable
        """
        try:
            return parse_link(link).host
        except CalendarError:
            return "invalid link"

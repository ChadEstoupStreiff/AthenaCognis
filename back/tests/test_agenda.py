from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pytest

from controllers.activity.agenda_ics import (
    CalendarError,
    calendar_events,
    parse_link,
)
from controllers.activity.agenda_source import AgendaDataSource, duration_text
from controllers.activity.base import DataSource, SourceUnavailableError, TimeRange

DAY = datetime(2026, 11, 18)
WINDOW = TimeRange(DAY, DAY + timedelta(days=1))
GOOGLE = "https://calendar.google.com/calendar/ical/me/private-secret/basic.ics"
ICLOUD = "webcal://p01-caldav.icloud.com/published/2/abc"
ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Work
BEGIN:VEVENT
UID:standup
SUMMARY:Standup
DTSTART;TZID=Europe/Paris:20261116T093000
DTEND;TZID=Europe/Paris:20261116T094500
RRULE:FREQ=DAILY
ATTENDEE;CN=Ann:mailto:ann@x.org
ATTENDEE:mailto:bob@x.org
LOCATION:Room 2
DESCRIPTION:Daily sync
END:VEVENT
BEGIN:VEVENT
UID:holiday
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261118
DTEND;VALUE=DATE:20261119
END:VEVENT
BEGIN:VEVENT
UID:review
SUMMARY:Review
STATUS:TENTATIVE
DTSTART:20261118T140000Z
DURATION:PT1H30M
END:VEVENT
BEGIN:VEVENT
UID:gone
SUMMARY:Cancelled call
STATUS:CANCELLED
DTSTART:20261118T160000Z
DTEND:20261118T163000Z
END:VEVENT
BEGIN:VEVENT
UID:old
SUMMARY:Old
DTSTART:20261110T100000Z
DTEND:20261110T110000Z
END:VEVENT
END:VCALENDAR
"""
Settings = dict[str, object]


@dataclass
class FakeWeb:
    """Calendar host answering every link with the same ICS, recording calls."""

    is_up: bool = True
    calls: list[str] = field(default_factory=list)

    def __call__(self, link: str, timeout: float) -> bytes:
        """
        Answer one download

        Args:
            link (str): ICS link
            timeout (float): timeout
        Returns:
            bytes: ICS content
        Raises:
            CalendarError: host down
        """
        del timeout
        self.calls.append(link)
        if not self.is_up:
            raise CalendarError("HTTP Error 404: Not Found")
        return ICS


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """
    Replace the data source settings with an editable dict, agenda added

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Settings: settings
    """
    values: Settings = {
        "activity_agenda_added": True,
        "activity_agenda_google": GOOGLE,
        # Every content field: these tests check them all.
        "activity_agenda_include": [
            item.key for item in AgendaDataSource().content_fields()
        ],
    }
    monkeypatch.setattr(DataSource, "read_setting", staticmethod(values.get))
    return values


@pytest.fixture
def web(monkeypatch: pytest.MonkeyPatch) -> FakeWeb:
    """
    Route calendar downloads to a fake host

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        FakeWeb: host
    """
    fake = FakeWeb()
    monkeypatch.setattr(AgendaDataSource, "fetch", staticmethod(fake))
    return fake


def test_parse_link_maps_webcal_and_credentials() -> None:
    link = parse_link(" webcal://me%40x.org:p%3Ass@cloud.x.org:8443/cal.ics?export ")
    assert link.url == "https://cloud.x.org:8443/cal.ics?export"
    assert link.authorization == "Basic bWVAeC5vcmc6cDpzcw=="
    assert link.host == "cloud.x.org"
    assert parse_link(GOOGLE).authorization is None
    for bad in ("file:///etc/passwd", "calendar.ics", ""):
        with pytest.raises(CalendarError):
            parse_link(bad)


def test_calendar_events_expand_recurrences_and_drop_cancelled() -> None:
    events = {event.uid: event for event in calendar_events(ICS, WINDOW)}
    assert "gone" not in events
    standup = [
        event for event in calendar_events(ICS, WINDOW) if event.uid == "standup"
    ]
    assert DAY.replace(hour=8, minute=30) in [event.start for event in standup]
    assert events["holiday"].is_all_day
    assert events["holiday"].start == DAY.replace(hour=12)
    assert events["review"].duration == timedelta(hours=1, minutes=30)
    with pytest.raises(CalendarError):
        calendar_events(b"not a calendar", WINDOW)


def test_duration_text() -> None:
    assert duration_text(timedelta(minutes=15), False) == "15 min"
    assert duration_text(timedelta(hours=2), False) == "2 h"
    assert duration_text(timedelta(hours=1, minutes=30), False) == "1 h 30 min"
    assert duration_text(timedelta(days=3), True) == "3 days"


def test_agenda_feed(settings: Settings, web: FakeWeb) -> None:
    source = AgendaDataSource()
    assert source.detail() == "1 calendar"
    secrets = {item["key"]: item["secret"] for item in source.info().config}
    assert secrets["activity_agenda_google"] is True
    assert secrets["activity_agenda_include_regex"] is False
    feed = source.activities(WINDOW)
    assert [(item.kind, item.title) for item in feed] == [
        ("event", "Review"),
        ("all_day", "Holiday"),
        ("event", "Standup"),
    ]
    standup = feed[2]
    assert standup.occurred_at == DAY.replace(hour=8, minute=30)
    assert standup.actors == ("Ann", "bob@x.org")
    assert standup.summary == "Daily sync"
    assert standup.details == {
        "duration": "15 min",
        "provider": "google",
        "calendar": "Work",
        "location": "Room 2",
    }
    assert feed[0].details["status"] == "tentative"
    assert standup.id == "agenda:google:standup:20261118T0830"


def test_agenda_settings_and_cache(settings: Settings, web: FakeWeb) -> None:
    source = AgendaDataSource()
    settings.update(
        {
            "activity_agenda_icloud": f"{ICLOUD}\n\n",
            "activity_agenda_skip_all_day": True,
            "activity_agenda_share_people": False,
            "activity_agenda_exclude_regex": "^review$",
        }
    )
    assert source.detail() == "2 calendars"
    feed = source.activities(WINDOW)
    assert [(item.title, item.details["provider"]) for item in feed] == [
        ("Standup", "google"),
        ("Standup", "icloud"),
    ]
    assert feed[0].actors == ()
    assert feed[0].summary == ""
    assert "location" not in feed[0].details
    source.activities(WINDOW)
    assert web.calls == [GOOGLE, ICLOUD]


def test_unreachable_calendar_names_host_only(settings: Settings, web: FakeWeb) -> None:
    web.is_up = False
    with pytest.raises(SourceUnavailableError) as error:
        AgendaDataSource().activities(WINDOW)
    message = str(error.value)
    assert "Google Calendar links (calendar.google.com)" in message
    assert "private-secret" not in message


def test_no_link_is_an_empty_feed(settings: Settings, web: FakeWeb) -> None:
    del settings["activity_agenda_google"]
    source = AgendaDataSource()
    assert source.detail() == "No calendar linked"
    assert source.activities(WINDOW) == []
    assert web.calls == []

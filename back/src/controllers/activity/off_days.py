"""Non working days of the scheduled daily generation: weekdays, holidays, off days, agenda."""

import logging
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import lru_cache

import holidays

LOGGER = logging.getLogger(__name__)

SETTING_PREFIX = "activity_generation_daily_"
WEEKDAYS_SETTING = f"{SETTING_PREFIX}weekdays"
COUNTRY_SETTING = f"{SETTING_PREFIX}holidays_country"
SUBDIVISION_SETTING = f"{SETTING_PREFIX}holidays_subdivision"
OFF_DAYS_SETTING = f"{SETTING_PREFIX}off_days"
AGENDA_SETTING = f"{SETTING_PREFIX}agenda_off"
KEYWORDS_SETTING = f"{SETTING_PREFIX}agenda_off_keywords"
# Stored codes of the weekdays, index = Python weekday (Monday = 0).
WEEKDAY_CODES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
DAY_FORMAT = "%Y-%m-%d"
RANGE_SEPARATOR = "/"
# A span has at most a first and a last day.
MAX_RANGE_PARTS = 2
KEYWORD_SEPARATOR = ","
COUNTRY_CODE_LENGTH = 2
# Titles of all-day agenda events marking a day off (whole words, any case).
DEFAULT_KEYWORDS = ("vacation", "holiday", "out of office", "OOO", "PTO", "congé", "congés")
# Longest span of days the status of a calendar view may cover.
MAX_STATUS_DAYS = 400

SettingReader = Callable[[str], object]


@dataclass(frozen=True)
class DayRange:
    """Inclusive span of local days."""

    first: date
    last: date

    def contains(self, day: date) -> bool:
        """
        Tell whether a day is in the span

        Args:
            day (date): local day
        Returns:
            bool: True when first <= day <= last
        """
        return self.first <= day <= self.last


@dataclass(frozen=True)
class OffDayRules:
    """What makes a day non working."""

    # Weekday codes to generate ("mon" … "sun"); empty = every day.
    weekdays: tuple[str, ...] = ()
    # ISO country code of the public holidays, "" = none.
    country: str = ""
    # Subdivision code of the country (state, region), "" = whole country.
    subdivision: str = ""
    ranges: tuple[DayRange, ...] = ()
    # Read all-day agenda events matching the keywords.
    agenda: bool = False
    keywords: tuple[str, ...] = DEFAULT_KEYWORDS


def parse_range(text: str) -> DayRange | None:
    """
    Read a stored off day ("YYYY-MM-DD") or span ("YYYY-MM-DD/YYYY-MM-DD")

    Args:
        text (str): stored value
    Returns:
        DayRange | None: span (bounds sorted), None when malformed
    """
    parts = text.strip().split(RANGE_SEPARATOR)
    if len(parts) > MAX_RANGE_PARTS:
        return None
    try:
        days = sorted(datetime.strptime(part.strip(), DAY_FORMAT).date() for part in parts)
    except ValueError:
        LOGGER.warning("Malformed off day %r ignored.", text)
        return None
    return DayRange(days[0], days[-1])


def strings(value: object) -> list[str]:
    """
    Strings of a stored list

    Args:
        value (object): stored value
    Returns:
        list[str]: strings, empty when not a list
    """
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def text(value: object) -> str:
    """
    Stored text, trimmed

    Args:
        value (object): stored value
    Returns:
        str: text, "" when not a string
    """
    return value.strip() if isinstance(value, str) else ""


def read_keywords(value: object) -> tuple[str, ...]:
    """
    Read the comma separated agenda keywords

    Args:
        value (object): stored value
    Returns:
        tuple[str, ...]: keywords, defaults when unset or blank
    """
    keywords = tuple(word.strip() for word in text(value).split(KEYWORD_SEPARATOR) if word.strip())
    return keywords or DEFAULT_KEYWORDS


def read_rules(read: SettingReader) -> OffDayRules:
    """
    Read the non working day settings

    Args:
        read (SettingReader): setting reader
    Returns:
        OffDayRules: rules, malformed values left out
    """
    ranges = (parse_range(item) for item in strings(read(OFF_DAYS_SETTING)))
    return OffDayRules(
        weekdays=tuple(code for code in strings(read(WEEKDAYS_SETTING)) if code in WEEKDAY_CODES),
        country=text(read(COUNTRY_SETTING)).upper(),
        subdivision=text(read(SUBDIVISION_SETTING)).upper(),
        ranges=tuple(item for item in ranges if item is not None),
        agenda=read(AGENDA_SETTING) is True,
        keywords=read_keywords(read(KEYWORDS_SETTING)),
    )


@lru_cache(maxsize=32)
def holidays_of(country: str, subdivision: str, year: int) -> dict[date, str]:
    """
    Public holidays of a country (and subdivision) in a year

    Args:
        country (str): ISO country code
        subdivision (str): subdivision code, "" = whole country
        year (int): year
    Returns:
        dict[date, str]: holiday name per day, empty when the country is unknown
    """
    try:
        found = holidays.country_holidays(country, subdiv=subdivision or None, years=year)
    except NotImplementedError:
        LOGGER.warning("No holidays known for %s %s.", country, subdivision)
        return {}
    return dict(found.items())


def holiday_name(day: date, rules: OffDayRules) -> str | None:
    """
    Public holiday of a day

    Args:
        day (date): local day
        rules (OffDayRules): rules
    Returns:
        str | None: holiday name, None when no country or not a holiday
    """
    if not rules.country:
        return None
    return holidays_of(rules.country, rules.subdivision, day.year).get(day)


def off_reason(day: date, rules: OffDayRules) -> str | None:
    """
    Why a day is non working, from the settings alone (agenda left out)

    Args:
        day (date): local day
        rules (OffDayRules): rules
    Returns:
        str | None: reason, None for a working day
    """
    if rules.weekdays and WEEKDAY_CODES[day.weekday()] not in rules.weekdays:
        return f"{WEEKDAY_NAMES[day.weekday()]} not picked"
    holiday = holiday_name(day, rules)
    if holiday is not None:
        return f"Holiday: {holiday}"
    if any(item.contains(day) for item in rules.ranges):
        return "Off day"
    return None


def keyword_pattern(keywords: Iterable[str]) -> re.Pattern[str]:
    """
    Pattern matching any keyword as whole words, any case

    Args:
        keywords (Iterable[str]): keywords
    Returns:
        re.Pattern[str]: pattern
    """
    words = "|".join(re.escape(word) for word in keywords)
    return re.compile(rf"(?<!\w)(?:{words})(?!\w)", re.IGNORECASE)


def agenda_reason(titles: Iterable[str], keywords: Iterable[str]) -> str | None:
    """
    Why a day is off, from the titles of its all-day agenda events

    Args:
        titles (Iterable[str]): titles of the day's all-day events
        keywords (Iterable[str]): keywords marking a day off
    Returns:
        str | None: "Agenda: <title>" of the first match, None when none matches
    """
    pattern = keyword_pattern(keywords)
    match = next((title for title in titles if pattern.search(title)), None)
    return None if match is None else f"Agenda: {match}"


def days_between(first: date, last: date) -> list[date]:
    """
    Every day of an inclusive span

    Args:
        first (date): first day
        last (date): last day
    Returns:
        list[date]: days
    Raises:
        ValueError: last before first, or span longer than MAX_STATUS_DAYS
    """
    count = (last - first).days + 1
    if count < 1 or count > MAX_STATUS_DAYS:
        raise ValueError(f"Span must hold 1 to {MAX_STATUS_DAYS} days.")
    return [first + timedelta(days=offset) for offset in range(count)]


def supported_countries() -> dict[str, list[str]]:
    """
    Countries with known holidays and their subdivisions

    Returns:
        dict[str, list[str]]: subdivision codes per two-letter country code
    """
    return {
        code: sorted(subdivisions)
        for code, subdivisions in sorted(holidays.list_supported_countries().items())
        if len(code) == COUNTRY_CODE_LENGTH
    }


def read_skipped(value: object) -> dict[str, str]:
    """
    Read the skipped days setting

    Args:
        value (object): stored value
    Returns:
        dict[str, str]: reason per "YYYY-MM-DD", empty when malformed
    """
    if not isinstance(value, dict):
        return {}
    return {
        key: reason
        for key, reason in value.items()
        if isinstance(key, str) and isinstance(reason, str)
    }

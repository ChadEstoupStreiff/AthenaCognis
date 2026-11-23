"""Scheduled activity generation: settings, due periods, and the scheduler thread."""

import logging
import threading
import time as clock
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.exc import SQLAlchemyError

from controllers.activity.generation import (
    DAY_FORMAT,
    OUTPUTS,
    DailyRequest,
    GenerationRequestError,
    Output,
)
from controllers.activity.off_days import (
    OffDayRules,
    agenda_reason,
    off_reason,
    read_rules,
    read_skipped,
)

LOGGER = logging.getLogger(__name__)

SETTING_PREFIX = "activity_generation_"
TIMEZONE_SETTING = f"{SETTING_PREFIX}timezone"
DAY_START_SETTING = f"{SETTING_PREFIX}day_start"
DEFAULT_TIMEZONE = "UTC"
DEFAULT_DAY_START = time(0, 0)
CHECK_INTERVAL_SECONDS = 60
CLOCK_FORMAT = "%H:%M"
SKIPPED_SETTING = f"{SETTING_PREFIX}daily_skipped"
# Days kept in the skipped days setting (older ones are dropped).
MAX_SKIPPED_DAYS = 400

SettingReader = Callable[[str], object]
SettingWriter = Callable[[str, object], None]


@dataclass(frozen=True)
class DailySchedule:
    """Settings of the scheduled daily generation."""

    enabled: bool
    zone: ZoneInfo
    # Local moment a day starts (and the previous one gets generated).
    day_start: time
    sources: tuple[str, ...]
    outputs: tuple[Output, ...]
    off: OffDayRules
    # Key of the last day queued by the scheduler, "" when never.
    last: str


@dataclass(frozen=True)
class DuePeriod:
    """Day whose generation is due: its key and local bounds."""

    key: str
    start: datetime
    end: datetime


def span_key(span: str, name: str) -> str:
    """
    Setting key of a schedule field

    Args:
        span (str): "daily", "weekly" or "monthly"
        name (str): field name (e.g. "enabled")
    Returns:
        str: "activity_generation_<span>_<name>"
    """
    return f"{SETTING_PREFIX}{span}_{name}"


def read_zone(read: SettingReader) -> ZoneInfo:
    """
    Time zone of the user (saved by the Activity page)

    Args:
        read (SettingReader): setting reader
    Returns:
        ZoneInfo: zone, UTC when unset or unknown
    """
    name = read(TIMEZONE_SETTING)
    try:
        return ZoneInfo(name if isinstance(name, str) and name else DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        LOGGER.warning("Unknown time zone %r, using UTC.", name)
        return ZoneInfo(DEFAULT_TIMEZONE)


def read_day_start(read: SettingReader) -> time:
    """
    Local moment a day starts

    Args:
        read (SettingReader): setting reader
    Returns:
        time: "HH:MM" setting, midnight when unset or malformed
    """
    value = read(DAY_START_SETTING)
    try:
        return datetime.strptime(str(value), CLOCK_FORMAT).time()
    except ValueError:
        return DEFAULT_DAY_START


def read_names(value: object) -> tuple[str, ...]:
    """
    Read a stored list of names

    Args:
        value (object): stored value
    Returns:
        tuple[str, ...]: strings, empty when not a list
    """
    items = value if isinstance(value, list) else []
    return tuple(item for item in items if isinstance(item, str))


def read_daily(read: SettingReader) -> DailySchedule:
    """
    Read the daily schedule settings

    Args:
        read (SettingReader): setting reader
    Returns:
        DailySchedule: schedule (outputs default to both)
    """
    outputs_value = read(span_key("daily", "outputs"))
    outputs = (
        tuple(item for item in read_names(outputs_value) if item in OUTPUTS)
        if isinstance(outputs_value, list)
        else OUTPUTS
    )
    last = read(span_key("daily", "last"))
    return DailySchedule(
        enabled=read(span_key("daily", "enabled")) is True,
        zone=read_zone(read),
        day_start=read_day_start(read),
        sources=read_names(read(span_key("daily", "sources"))),
        outputs=outputs,  # type: ignore[arg-type]
        off=read_rules(read),
        last=last if isinstance(last, str) else "",
    )


def due_day(now: datetime, schedule: DailySchedule) -> DuePeriod | None:
    """
    Day that ended at the latest day start, when the scheduler has not queued it yet

    Args:
        now (datetime): current moment, aware
        schedule (DailySchedule): schedule
    Returns:
        DuePeriod | None: day to generate, None when disabled or already queued
    """
    if not schedule.enabled:
        return None
    local = now.astimezone(schedule.zone)
    boundary = datetime.combine(local.date(), schedule.day_start, schedule.zone)
    if boundary > local:
        boundary -= timedelta(days=1)
    start = datetime.combine(
        boundary.date() - timedelta(days=1), schedule.day_start, schedule.zone
    )
    key = start.strftime(DAY_FORMAT)
    if key == schedule.last:
        return None
    return DuePeriod(key, start, boundary)


def daily_request(
    period: DuePeriod, sources: tuple[str, ...], outputs: tuple[Output, ...]
) -> DailyRequest:
    """
    Generation request of a due day

    Args:
        period (DuePeriod): day, aware local bounds
        sources (tuple[str, ...]): data source keys
        outputs (tuple[Output, ...]): what to generate
    Returns:
        DailyRequest: request with the window in naive UTC
    Raises:
        GenerationRequestError: no source or no output
    """
    offset = period.start.utcoffset() or timedelta()
    return DailyRequest(
        day=period.key,
        start=period.start.astimezone(ZoneInfo(DEFAULT_TIMEZONE)).replace(tzinfo=None),
        end=period.end.astimezone(ZoneInfo(DEFAULT_TIMEZONE)).replace(tzinfo=None),
        utc_offset_minutes=int(offset.total_seconds() // 60),
        sources=sources,
        outputs=outputs,
    )


@dataclass
class SchedulerHooks:
    """What the scheduler reads and calls (replaced in tests)."""

    read: SettingReader
    write: SettingWriter
    # Keys of the enabled data sources.
    active_sources: Callable[[], tuple[str, ...]]
    # Tell whether a day was already generated or is generating (manual runs count).
    has_run: Callable[[str], bool]
    queue: Callable[[DailyRequest], None]
    # Titles of the all-day agenda events of a local day (empty when unreadable).
    agenda_titles: Callable[[date], tuple[str, ...]]


def skip_reason(period: DuePeriod, rules: OffDayRules, hooks: SchedulerHooks) -> str | None:
    """
    Why a due day is not generated: non working day by settings, then by agenda

    Args:
        period (DuePeriod): due day
        rules (OffDayRules): non working day rules
        hooks (SchedulerHooks): agenda reader
    Returns:
        str | None: reason, None for a working day
    """
    reason = off_reason(period.start.date(), rules)
    if reason is not None or not rules.agenda:
        return reason
    return agenda_reason(hooks.agenda_titles(period.start.date()), rules.keywords)


def record_skip(hooks: SchedulerHooks, day: str, reason: str) -> None:
    """
    Keep why the scheduler skipped a day (latest MAX_SKIPPED_DAYS days only)

    Args:
        hooks (SchedulerHooks): settings
        day (str): "YYYY-MM-DD"
        reason (str): why
    Returns:
        None
    """
    skipped = read_skipped(hooks.read(SKIPPED_SETTING))
    skipped[day] = reason
    kept = sorted(skipped)[-MAX_SKIPPED_DAYS:]
    hooks.write(SKIPPED_SETTING, {key: skipped[key] for key in kept})


def run_due(now: datetime, hooks: SchedulerHooks) -> str | None:
    """
    Queue the daily generation when due (manual runs of that day are kept)

    Args:
        now (datetime): current moment, aware
        hooks (SchedulerHooks): settings, sources and queue
    Returns:
        str | None: day queued, None when nothing was queued
    """
    schedule = read_daily(hooks.read)
    period = due_day(now, schedule)
    if period is None:
        return None
    hooks.write(span_key("daily", "last"), period.key)
    if hooks.has_run(period.key):
        LOGGER.info("Scheduled generation of %s skipped: already generated.", period.key)
        return None
    reason = skip_reason(period, schedule.off, hooks)
    if reason is not None:
        record_skip(hooks, period.key, reason)
        LOGGER.info("Scheduled generation of %s skipped: %s.", period.key, reason)
        return None
    sources = schedule.sources or hooks.active_sources()
    try:
        hooks.queue(daily_request(period, sources, schedule.outputs))
    except GenerationRequestError as error:
        LOGGER.warning("Scheduled generation of %s skipped: %s", period.key, error)
        return None
    LOGGER.info("Scheduled generation of %s queued.", period.key)
    return period.key


class GenerationScheduler:
    """Background thread checking the schedules every minute."""

    thread: threading.Thread | None = None

    @classmethod
    def start(cls, hooks: SchedulerHooks) -> None:
        """
        Start the scheduler thread once

        Args:
            hooks (SchedulerHooks): settings, sources and queue
        Returns:
            None
        """
        if cls.thread is not None and cls.thread.is_alive():
            return
        cls.thread = threading.Thread(target=cls.run, args=(hooks,), daemon=True)
        cls.thread.start()

    @classmethod
    def run(cls, hooks: SchedulerHooks) -> None:
        """
        Check the schedules forever

        Args:
            hooks (SchedulerHooks): settings, sources and queue
        Returns:
            None
        """
        while True:
            try:
                run_due(datetime.now(ZoneInfo(DEFAULT_TIMEZONE)), hooks)
            except (SQLAlchemyError, OSError, RuntimeError, ValueError, LookupError) as error:
                LOGGER.exception("Activity generation scheduler failed: %s", error)
            clock.sleep(CHECK_INTERVAL_SECONDS)

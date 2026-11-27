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
    BASES,
    DAY_FORMAT,
    OUTPUTS,
    SPANS,
    SUMMARY_ONLY,
    WEEK_DAYS,
    Basis,
    GenerationRequest,
    GenerationRequestError,
    Output,
    Span,
    job_key,
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
WEEK_START_SETTING = f"{SETTING_PREFIX}week_start"
DEFAULT_TIMEZONE = "UTC"
DEFAULT_DAY_START = time(0, 0)
# ISO weekday weeks start on (1 = Monday … 7 = Sunday).
DEFAULT_WEEK_START = 1
SECONDS_PER_MINUTE = 60
CHECK_INTERVAL_SECONDS = 60
CLOCK_FORMAT = "%H:%M"
SKIPPED_SETTING = f"{SETTING_PREFIX}daily_skipped"
# Days kept in the skipped days setting (older ones are dropped).
MAX_SKIPPED_DAYS = 400

SettingReader = Callable[[str], object]
SettingWriter = Callable[[str, object], None]


@dataclass(frozen=True)
class SpanSchedule:
    """Settings of the scheduled generation of one span."""

    span: Span
    enabled: bool
    zone: ZoneInfo
    # Local moment a day starts (and the previous period gets generated).
    day_start: time
    # ISO weekday weeks start on.
    week_start: int
    basis: Basis
    # Monthly from weekly: days no weekly summary covers use their daily summary.
    fill_daily: bool
    # Data source keys; empty = every enabled source.
    sources: tuple[str, ...]
    instruction: str
    # What to generate; time entries for the daily schedule only.
    outputs: tuple[Output, ...]
    # Key of the last period queued by the scheduler, "" when never.
    last: str


@dataclass(frozen=True)
class DuePeriod:
    """Period whose generation is due: its first day and local bounds."""

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


def read_week_start(read: SettingReader) -> int:
    """
    ISO weekday weeks start on

    Args:
        read (SettingReader): setting reader
    Returns:
        int: 1 (Monday) … 7 (Sunday), Monday when unset or malformed
    """
    value = read(WEEK_START_SETTING)
    if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= WEEK_DAYS:
        return value
    return DEFAULT_WEEK_START


def read_basis(value: object, span: Span) -> Basis:
    """
    Context stored for a span

    Args:
        value (object): stored value
        span (Span): time span
    Returns:
        Basis: stored context when offered, the span's first one otherwise
    """
    offered = BASES[span]
    return next((basis for basis in offered if basis == value), offered[0])


def read_text(value: object) -> str:
    """
    Read a stored text

    Args:
        value (object): stored value
    Returns:
        str: trimmed text, "" when not a string
    """
    return value.strip() if isinstance(value, str) else ""


def read_outputs(value: object, span: Span) -> tuple[Output, ...]:
    """
    Outputs stored for a span

    Args:
        value (object): stored value
        span (Span): time span
    Returns:
        tuple[Output, ...]: daily: stored outputs (both when unset); others: summary only
    """
    if span != "daily":
        return SUMMARY_ONLY
    if not isinstance(value, list):
        return OUTPUTS
    return tuple(output for output in OUTPUTS if output in read_names(value))


def read_schedule(read: SettingReader, span: Span) -> SpanSchedule:
    """
    Read the schedule settings of a span

    Args:
        read (SettingReader): setting reader
        span (Span): time span
    Returns:
        SpanSchedule: schedule
    """
    return SpanSchedule(
        span=span,
        enabled=read(span_key(span, "enabled")) is True,
        zone=read_zone(read),
        day_start=read_day_start(read),
        week_start=read_week_start(read),
        basis=read_basis(read(span_key(span, "basis")), span),
        fill_daily=read(span_key(span, "fill_daily")) is True,
        sources=read_names(read(span_key(span, "sources"))),
        instruction=read_text(read(span_key(span, "instruction"))),
        outputs=read_outputs(read(span_key(span, "outputs")), span),
        last=read_text(read(span_key(span, "last"))),
    )


def current_day(local: datetime, day_start: time) -> date:
    """
    Local day running at a moment, days starting at the day start

    Args:
        local (datetime): moment, aware in the user zone
        day_start (time): local moment a day starts
    Returns:
        date: running day
    """
    boundary = datetime.combine(local.date(), day_start, local.tzinfo)
    return local.date() if boundary <= local else local.date() - timedelta(days=1)


def ended_period(today: date, schedule: SpanSchedule) -> tuple[date, date]:
    """
    Latest period of a span ended before a day

    Args:
        today (date): running local day
        schedule (SpanSchedule): schedule
    Returns:
        tuple[date, date]: first day, and first day of the next period
    """
    if schedule.span == "daily":
        return today - timedelta(days=1), today
    if schedule.span == "weekly":
        week_start = today - timedelta(days=(today.isoweekday() - schedule.week_start) % WEEK_DAYS)
        return week_start - timedelta(days=WEEK_DAYS), week_start
    month_start = today.replace(day=1)
    return (month_start - timedelta(days=1)).replace(day=1), month_start


def due_period(now: datetime, schedule: SpanSchedule) -> DuePeriod | None:
    """
    Period that ended at the latest boundary, when the scheduler has not queued it yet

    Args:
        now (datetime): current moment, aware
        schedule (SpanSchedule): schedule
    Returns:
        DuePeriod | None: period to generate, None when disabled or already queued
    """
    if not schedule.enabled:
        return None
    first, after = ended_period(current_day(now.astimezone(schedule.zone), schedule.day_start), schedule)
    key = first.strftime(DAY_FORMAT)
    if key == schedule.last:
        return None
    return DuePeriod(
        key,
        datetime.combine(first, schedule.day_start, schedule.zone),
        datetime.combine(after, schedule.day_start, schedule.zone),
    )


def naive_utc(moment: datetime) -> datetime:
    """
    Convert an aware moment to naive UTC

    Args:
        moment (datetime): aware moment
    Returns:
        datetime: naive UTC
    """
    return moment.astimezone(ZoneInfo(DEFAULT_TIMEZONE)).replace(tzinfo=None)


def period_request(
    period: DuePeriod, schedule: SpanSchedule, sources: tuple[str, ...]
) -> GenerationRequest:
    """
    Generation request of a due period

    Args:
        period (DuePeriod): period, aware local bounds
        schedule (SpanSchedule): schedule
        sources (tuple[str, ...]): data source keys (used with the data sources context)
    Returns:
        GenerationRequest: request with the window in naive UTC
    Raises:
        GenerationRequestError: data sources context without source, or no output
    """
    offset = period.start.utcoffset() or timedelta()
    return GenerationRequest(
        span=schedule.span,
        day=period.key,
        start=naive_utc(period.start),
        end=naive_utc(period.end),
        utc_offset_minutes=int(offset.total_seconds() // SECONDS_PER_MINUTE),
        basis=schedule.basis,
        sources=sources if schedule.basis == "sources" else (),
        instruction=schedule.instruction,
        fill_daily=schedule.fill_daily,
        outputs=schedule.outputs,
    )


@dataclass
class SchedulerHooks:
    """What the scheduler reads and calls (replaced in tests)."""

    read: SettingReader
    write: SettingWriter
    # Keys of the enabled data sources.
    active_sources: Callable[[], tuple[str, ...]]
    # Tell whether a job key was already generated or is generating (manual runs count).
    has_run: Callable[[str], bool]
    queue: Callable[[GenerationRequest], None]
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


def is_skipped(period: DuePeriod, hooks: SchedulerHooks) -> bool:
    """
    Skip a due day that is non working, keeping why

    Args:
        period (DuePeriod): due day
        hooks (SchedulerHooks): settings and agenda
    Returns:
        bool: True when skipped
    """
    reason = skip_reason(period, read_rules(hooks.read), hooks)
    if reason is None:
        return False
    record_skip(hooks, period.key, reason)
    LOGGER.info("Scheduled generation of %s skipped: %s.", period.key, reason)
    return True


def run_span(now: datetime, span: Span, hooks: SchedulerHooks) -> str | None:
    """
    Queue the generation of a span when due (manual runs of that period are kept)

    Args:
        now (datetime): current moment, aware
        span (Span): time span
        hooks (SchedulerHooks): settings, sources and queue
    Returns:
        str | None: job key queued, None when nothing was queued
    """
    schedule = read_schedule(hooks.read, span)
    period = due_period(now, schedule)
    if period is None:
        return None
    hooks.write(span_key(span, "last"), period.key)
    key = job_key(span, period.key)
    if hooks.has_run(key):
        LOGGER.info("Scheduled generation of %s skipped: already generated.", key)
        return None
    if span == "daily" and is_skipped(period, hooks):
        return None
    try:
        hooks.queue(period_request(period, schedule, schedule.sources or hooks.active_sources()))
    except GenerationRequestError as error:
        LOGGER.warning("Scheduled generation of %s skipped: %s", key, error)
        return None
    LOGGER.info("Scheduled generation of %s queued.", key)
    return key


def run_due(now: datetime, hooks: SchedulerHooks) -> list[str]:
    """
    Queue every due generation, shorter spans first (longer ones may read them)

    Args:
        now (datetime): current moment, aware
        hooks (SchedulerHooks): settings, sources and queue
    Returns:
        list[str]: job keys queued
    """
    queued = (run_span(now, span, hooks) for span in SPANS)
    return [key for key in queued if key is not None]


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
            except (SQLAlchemyError, OSError, RuntimeError, ValueError, LookupError):
                LOGGER.exception("Activity generation scheduler failed.")
            clock.sleep(CHECK_INTERVAL_SECONDS)

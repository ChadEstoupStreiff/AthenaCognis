from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from controllers.activity.generation import GenerationRequest
from controllers.activity.generation_schedule import (
    MAX_SKIPPED_DAYS,
    SchedulerHooks,
    SpanSchedule,
    due_period,
    read_schedule,
    record_skip,
    run_due,
)
from controllers.activity.off_days import read_rules

PARIS = ZoneInfo("Europe/Paris")


def schedule(
    last: str = "", day_start: time = time(4, 0), span: str = "daily", enabled: bool = True
) -> SpanSchedule:
    """
    Schedule in Paris, weeks starting on Monday

    Args:
        last (str): last queued period
        day_start (time): local day start
        span (str): time span
        enabled (bool): schedule enabled
    Returns:
        SpanSchedule: schedule
    """
    is_daily = span == "daily"
    return SpanSchedule(
        span,  # type: ignore[arg-type]
        enabled,
        PARIS,
        day_start,
        1,
        "sources" if is_daily else "generated",
        False,
        ("github",),
        "",
        ("summary", "time") if is_daily else ("summary",),
        last,
    )


def test_due_day_is_the_day_ended_at_the_latest_day_start() -> None:
    # 2026-11-19 05:00 Paris (UTC+1): the day 18th 04:00 → 19th 04:00 just ended.
    period = due_period(datetime(2026, 11, 19, 4, 0, tzinfo=UTC), schedule())
    assert period is not None
    assert period.key == "2026-11-18"
    assert (period.start.hour, period.end.hour, period.end.day) == (4, 4, 19)
    # 03:00 Paris: the 19th has not started yet, the 17th → 18th day is due.
    earlier = due_period(datetime(2026, 11, 19, 2, 0, tzinfo=UTC), schedule())
    assert earlier is not None and earlier.key == "2026-11-17"


def test_due_week_and_month_end_at_their_boundary() -> None:
    # Thursday 2026-11-19: last full week is Mon 9th → Mon 16th; last month is October.
    now = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
    week = due_period(now, schedule(span="weekly"))
    assert week is not None
    assert (week.key, week.start.day, week.end.day) == ("2026-11-09", 9, 16)
    month = due_period(now, schedule(span="monthly"))
    assert month is not None
    assert (month.key, month.start.month, month.end.month, month.end.day) == (
        "2026-10-01",
        10,
        11,
        1,
    )
    # Monday 16th 03:00 Paris, before the 04:00 day start: the week still runs.
    early = due_period(datetime(2026, 11, 16, 2, 0, tzinfo=UTC), schedule(span="weekly"))
    assert early is not None and early.key == "2026-11-02"


def test_due_period_skips_queued_or_disabled() -> None:
    now = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
    assert due_period(now, schedule(last="2026-11-18")) is None
    assert due_period(now, schedule(enabled=False)) is None


def test_read_schedule_defaults() -> None:
    settings: dict[str, object] = {"activity_generation_daily_enabled": True}
    daily = read_schedule(settings.get, "daily")
    assert (daily.enabled, daily.day_start, daily.basis, daily.sources, daily.instruction) == (
        True,
        time(0),
        "sources",
        (),
        "",
    )
    assert str(daily.zone) == "UTC"
    assert daily.outputs == ("summary", "time")
    assert read_schedule(settings.get, "monthly").basis == "generated"
    settings.update(
        {
            "activity_generation_timezone": "Europe/Paris",
            "activity_generation_day_start": "05:30",
            "activity_generation_week_start": 7,
            "activity_generation_weekly_basis": "generated_daily",
            "activity_generation_monthly_basis": "generated_daily",
            "activity_generation_monthly_fill_daily": True,
            "activity_generation_monthly_instruction": "  Be brief.  ",
            "activity_generation_daily_weekdays": ["mon", "fri", "bogus", 3],
            "activity_generation_daily_outputs": ["time", "bogus"],
            "activity_generation_weekly_outputs": ["summary", "time"],
        }
    )
    weekly = read_schedule(settings.get, "weekly")
    monthly = read_schedule(settings.get, "monthly")
    assert (str(weekly.zone), weekly.day_start, weekly.week_start, weekly.basis) == (
        "Europe/Paris",
        time(5, 30),
        7,
        "generated",
    )
    assert (monthly.basis, monthly.fill_daily, monthly.instruction) == (
        "generated_daily",
        True,
        "Be brief.",
    )
    assert read_rules(settings.get).weekdays == ("mon", "fri")
    assert read_schedule(settings.get, "daily").outputs == ("time",)
    assert (weekly.outputs, monthly.outputs) == (("summary",), ("summary",))


@dataclass
class Hooks:
    """Fake settings, sources and queue."""

    settings: dict[str, object] = field(default_factory=dict)
    generated: set[str] = field(default_factory=set)
    queued: list[GenerationRequest] = field(default_factory=list)
    agenda: dict[date, tuple[str, ...]] = field(default_factory=dict)

    def hooks(self) -> SchedulerHooks:
        """
        Build the scheduler hooks

        Returns:
            SchedulerHooks: hooks on this fake
        """
        return SchedulerHooks(
            read=self.settings.get,
            write=self.settings.__setitem__,
            active_sources=lambda: ("mail", "github"),
            has_run=lambda key: key in self.generated,
            queue=self.queued.append,
            agenda_titles=lambda day: self.agenda.get(day, ()),
        )


def test_run_due_queues_once_with_active_sources() -> None:
    fake = Hooks(
        {
            "activity_generation_daily_enabled": True,
            "activity_generation_timezone": "Europe/Paris",
        }
    )
    now = datetime(2026, 11, 19, 6, 0, tzinfo=UTC)
    assert run_due(now, fake.hooks()) == ["daily/2026-11-18"]
    [request] = fake.queued
    assert (request.span, request.basis) == ("daily", "sources")
    assert request.sources == ("mail", "github")
    assert request.outputs == ("summary", "time")
    assert (request.start, request.end) == (
        datetime(2026, 11, 17, 23, 0),
        datetime(2026, 11, 18, 23, 0),
    )
    assert request.utc_offset_minutes == 60
    assert run_due(now, fake.hooks()) == []
    assert len(fake.queued) == 1


def test_run_due_keeps_manual_generations() -> None:
    fake = Hooks({"activity_generation_daily_enabled": True}, generated={"daily/2026-11-18"})
    assert run_due(datetime(2026, 11, 19, 6, 0, tzinfo=UTC), fake.hooks()) == []
    assert fake.queued == []
    assert fake.settings["activity_generation_daily_last"] == "2026-11-18"


def test_run_due_skips_unpicked_weekdays() -> None:
    # 2026-11-22 is a Sunday: due on the 23rd, skipped with Monday-Friday picked.
    weekdays = ["mon", "tue", "wed", "thu", "fri"]
    fake = Hooks(
        {
            "activity_generation_daily_enabled": True,
            "activity_generation_daily_weekdays": weekdays,
        }
    )
    assert run_due(datetime(2026, 11, 23, 6, 0, tzinfo=UTC), fake.hooks()) == []
    assert fake.queued == []
    assert fake.settings["activity_generation_daily_last"] == "2026-11-22"
    assert fake.settings["activity_generation_daily_skipped"] == {"2026-11-22": "Sunday not picked"}
    # Monday 24th 06:00 UTC: Monday 23rd is due and picked.
    assert run_due(datetime(2026, 11, 24, 6, 0, tzinfo=UTC), fake.hooks()) == [
        "daily/2026-11-23"
    ]


def test_run_due_skips_holidays_off_days_and_agenda() -> None:
    fake = Hooks(
        {
            "activity_generation_daily_enabled": True,
            "activity_generation_daily_holidays_country": "fr",
            "activity_generation_daily_off_days": ["2026-12-27/2026-12-26"],
            "activity_generation_daily_agenda_off": True,
        },
        agenda={date(2026, 12, 28): ("Team sync", "Out of office")},
    )
    for day in (26, 27, 28, 29, 30):
        run_due(datetime(2026, 12, day, 6, 0, tzinfo=UTC), fake.hooks())
    assert fake.settings["activity_generation_daily_skipped"] == {
        "2026-12-25": "Holiday: Noël",
        "2026-12-26": "Off day",
        "2026-12-27": "Off day",
        "2026-12-28": "Agenda: Out of office",
    }
    assert [request.day for request in fake.queued] == ["2026-12-29"]


def test_record_skip_keeps_latest_days() -> None:
    fake = Hooks({"activity_generation_daily_skipped": {"2020-01-01": "old", "bad": 3}})
    for index in range(MAX_SKIPPED_DAYS):
        record_skip(fake.hooks(), f"2026-{index:04d}", "Off day")
    skipped = fake.settings["activity_generation_daily_skipped"]
    assert isinstance(skipped, dict)
    assert len(skipped) == MAX_SKIPPED_DAYS
    assert "2020-01-01" not in skipped and "bad" not in skipped


def test_run_due_queues_daily_then_weekly_then_monthly() -> None:
    fake = Hooks(
        {
            "activity_generation_daily_enabled": True,
            "activity_generation_weekly_enabled": True,
            "activity_generation_monthly_enabled": True,
            "activity_generation_monthly_basis": "sources",
            "activity_generation_monthly_instruction": "Be brief.",
            "activity_generation_timezone": "Europe/Paris",
        }
    )
    # Monday 2026-11-02 06:00 Paris: Sunday 1st, week of Oct 26 and October all ended.
    queued = run_due(datetime(2026, 11, 2, 5, 0, tzinfo=UTC), fake.hooks())
    assert queued == ["daily/2026-11-01", "weekly/2026-10-26", "monthly/2026-10-01"]
    week, month = fake.queued[1], fake.queued[2]
    assert [item.outputs for item in fake.queued] == [
        ("summary", "time"),
        ("summary",),
        ("summary",),
    ]
    assert (week.basis, week.sources, week.start) == ("generated", (), datetime(2026, 10, 25, 23))
    assert (month.basis, month.sources, month.instruction) == (
        "sources",
        ("mail", "github"),
        "Be brief.",
    )
    # October 1st 00:00 Paris (UTC+2) → November 1st 00:00 (UTC+1).
    assert (month.start, month.end) == (datetime(2026, 9, 30, 22), datetime(2026, 10, 31, 23))
    assert fake.settings["activity_generation_weekly_last"] == "2026-10-26"
    assert run_due(datetime(2026, 11, 2, 6, 0, tzinfo=UTC), fake.hooks()) == []


def test_off_days_never_skip_weekly() -> None:
    fake = Hooks(
        {
            "activity_generation_weekly_enabled": True,
            "activity_generation_daily_weekdays": ["mon"],
        }
    )
    assert run_due(datetime(2026, 11, 22, 12, 0, tzinfo=UTC), fake.hooks()) == [
        "weekly/2026-11-09"
    ]

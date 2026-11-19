from dataclasses import dataclass, field
from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

from controllers.activity.generation import DailyRequest
from controllers.activity.generation_schedule import (
    DailySchedule,
    SchedulerHooks,
    due_day,
    read_daily,
    run_due,
)

PARIS = ZoneInfo("Europe/Paris")


def schedule(last: str = "", day_start: time = time(4, 0)) -> DailySchedule:
    """
    Enabled daily schedule in Paris

    Args:
        last (str): last queued day
        day_start (time): local day start
    Returns:
        DailySchedule: schedule
    """
    return DailySchedule(True, PARIS, day_start, ("github",), ("summary", "time"), last)


def test_due_day_is_the_day_ended_at_the_latest_day_start() -> None:
    # 2026-11-19 05:00 Paris (UTC+1): the day 18th 04:00 → 19th 04:00 just ended.
    period = due_day(datetime(2026, 11, 19, 4, 0, tzinfo=UTC), schedule())
    assert period is not None
    assert period.key == "2026-11-18"
    assert (period.start.hour, period.end.hour, period.end.day) == (4, 4, 19)
    # 03:00 Paris: the 19th has not started yet, the 17th → 18th day is due.
    earlier = due_day(datetime(2026, 11, 19, 2, 0, tzinfo=UTC), schedule())
    assert earlier is not None and earlier.key == "2026-11-17"


def test_due_day_skips_queued_or_disabled() -> None:
    now = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
    assert due_day(now, schedule(last="2026-11-18")) is None
    disabled = DailySchedule(False, PARIS, time(0), (), ("summary",), "")
    assert due_day(now, disabled) is None


def test_read_daily_defaults() -> None:
    settings: dict[str, object] = {"activity_generation_daily_enabled": True}
    daily = read_daily(settings.get)
    assert (daily.enabled, daily.day_start, daily.outputs, daily.sources) == (
        True,
        time(0),
        ("summary", "time"),
        (),
    )
    assert str(daily.zone) == "UTC"
    settings.update(
        {
            "activity_generation_timezone": "Europe/Paris",
            "activity_generation_day_start": "05:30",
            "activity_generation_daily_outputs": ["time", "bogus"],
        }
    )
    daily = read_daily(settings.get)
    assert (str(daily.zone), daily.day_start, daily.outputs) == (
        "Europe/Paris",
        time(5, 30),
        ("time",),
    )


@dataclass
class Hooks:
    """Fake settings, sources and queue."""

    settings: dict[str, object] = field(default_factory=dict)
    generated: set[str] = field(default_factory=set)
    queued: list[DailyRequest] = field(default_factory=list)

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
            has_run=lambda day: day in self.generated,
            queue=self.queued.append,
        )


def test_run_due_queues_once_with_active_sources() -> None:
    fake = Hooks(
        {
            "activity_generation_daily_enabled": True,
            "activity_generation_timezone": "Europe/Paris",
        }
    )
    now = datetime(2026, 11, 19, 6, 0, tzinfo=UTC)
    assert run_due(now, fake.hooks()) == "2026-11-18"
    [request] = fake.queued
    assert request.sources == ("mail", "github")
    assert (request.start, request.end) == (
        datetime(2026, 11, 17, 23, 0),
        datetime(2026, 11, 18, 23, 0),
    )
    assert request.utc_offset_minutes == 60
    assert run_due(now, fake.hooks()) is None
    assert len(fake.queued) == 1


def test_run_due_keeps_manual_generations() -> None:
    fake = Hooks({"activity_generation_daily_enabled": True}, generated={"2026-11-18"})
    assert run_due(datetime(2026, 11, 19, 6, 0, tzinfo=UTC), fake.hooks()) is None
    assert fake.queued == []
    assert fake.settings["activity_generation_daily_last"] == "2026-11-18"

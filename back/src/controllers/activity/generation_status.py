"""Status of each day for the Activity calendar: generated, failed, running or skipped."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from controllers.activity.off_days import DAY_FORMAT, OffDayRules, off_reason
from db import TaskStateEnum

DayState = Literal["generated", "failed", "running", "skipped"]

TASK_STATES: dict[TaskStateEnum, DayState] = {
    TaskStateEnum.COMPLETED: "generated",
    TaskStateEnum.FAILED: "failed",
    TaskStateEnum.PENDING: "running",
    TaskStateEnum.IN_PROGRESS: "running",
}


@dataclass(frozen=True)
class DayStatus:
    """What happened to a day, and whether the settings make it non working."""

    day: str
    # None when never generated nor skipped.
    state: DayState | None
    # Why it was skipped, or why the latest run failed.
    reason: str | None
    # Why the settings make it non working (agenda left out), None for a working day.
    off: str | None


@dataclass(frozen=True)
class LatestRun:
    """Latest generation run of a day."""

    state: TaskStateEnum
    result: str | None


def day_status(
    day: date, run: LatestRun | None, skipped: str | None, rules: OffDayRules
) -> DayStatus:
    """
    Status of one day: its latest run first, then a scheduler skip

    Args:
        day (date): local day
        run (LatestRun | None): latest run, None when never run
        skipped (str | None): why the scheduler skipped it, None when not skipped
        rules (OffDayRules): non working day rules
    Returns:
        DayStatus: status
    """
    key = day.strftime(DAY_FORMAT)
    off = off_reason(day, rules)
    if run is not None:
        state = TASK_STATES[run.state]
        return DayStatus(key, state, run.result if state == "failed" else None, off)
    if skipped is not None:
        return DayStatus(key, "skipped", skipped, off)
    return DayStatus(key, None, None, off)


def day_statuses(
    days: Sequence[date],
    runs: Mapping[str, LatestRun],
    skipped: Mapping[str, str],
    rules: OffDayRules,
) -> list[DayStatus]:
    """
    Status of every day of a span

    Args:
        days (Sequence[date]): local days
        runs (Mapping[str, LatestRun]): latest run per "YYYY-MM-DD"
        skipped (Mapping[str, str]): scheduler skip reason per "YYYY-MM-DD"
        rules (OffDayRules): non working day rules
    Returns:
        list[DayStatus]: one status per day, in order
    """
    return [
        day_status(
            day, runs.get(day.strftime(DAY_FORMAT)), skipped.get(day.strftime(DAY_FORMAT)), rules
        )
        for day in days
    ]

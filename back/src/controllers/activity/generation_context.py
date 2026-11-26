"""Context of weekly and monthly summaries built from the summaries already generated."""

import logging
from datetime import date, timedelta
from pathlib import Path

from controllers.activity.generation import (
    DAY_FORMAT,
    WEEK_DAYS,
    GenerationRequest,
    Span,
    SummarySection,
    note_body,
    note_path,
    period_days,
)

LOGGER = logging.getLogger(__name__)

DAILY_LABEL_FORMAT = "%A %Y-%m-%d"


def read_note(root: Path, span: Span, day: date) -> str | None:
    """
    Body of the generated note of a period

    Args:
        root (Path): shared root
        span (Span): time span
        day (date): first day of the period
    Returns:
        str | None: body without title, None when missing, unreadable or empty
    """
    path = note_path(root, span, day.strftime(DAY_FORMAT))
    if not path.is_file():
        return None
    try:
        body = note_body(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as error:
        LOGGER.warning("Generated note %s unreadable: %s", path, error)
        return None
    return body or None


def daily_sections(root: Path, days: list[date]) -> list[SummarySection]:
    """
    Daily summaries of some days

    Args:
        root (Path): shared root
        days (list[date]): days, in order
    Returns:
        list[SummarySection]: one per day with a summary
    """
    sections = []
    for day in days:
        body = read_note(root, "daily", day)
        if body is not None:
            sections.append(SummarySection(f"Day · {day:{DAILY_LABEL_FORMAT}}", body))
    return sections


def weekly_sections(root: Path, days: tuple[date, ...]) -> tuple[list[SummarySection], set[date]]:
    """
    Weekly summaries of the weeks overlapping some days

    Args:
        root (Path): shared root
        days (tuple[date, ...]): days of the period, in order
    Returns:
        tuple[list[SummarySection], set[date]]: one section per week found, days they cover
    """
    sections: list[SummarySection] = []
    covered: set[date] = set()
    first = days[0] - timedelta(days=WEEK_DAYS - 1)
    for offset in range((days[-1] - first).days + 1):
        week_start = first + timedelta(days=offset)
        body = read_note(root, "weekly", week_start)
        if body is None:
            continue
        week = period_days("weekly", week_start)
        sections.append(SummarySection(f"Week · {week[0]} → {week[-1]}", body))
        covered.update(week)
    return sections, covered


def generated_sections(root: Path, request: GenerationRequest) -> list[SummarySection]:
    """
    Summaries a weekly or monthly request is built from

    Args:
        root (Path): shared root
        request (GenerationRequest): request with a generated context
    Returns:
        list[SummarySection]: summaries, in period order
    """
    days = request.days
    if request.span == "weekly" or request.basis == "generated_daily":
        return daily_sections(root, list(days))
    weeks, covered = weekly_sections(root, days)
    if not request.fill_daily:
        return weeks
    gaps = daily_sections(root, [day for day in days if day not in covered])
    return weeks + gaps

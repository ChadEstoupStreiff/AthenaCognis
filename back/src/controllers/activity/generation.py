"""Activity generation: request, LLM context and note of a daily, weekly or monthly summary.

Daily requests may also ask time entries (see generation_time.py).
"""

import json
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal, cast

from controllers.activity.base import Activity

# Non-editable project holding every generated note and time entry.
ACTIVITY_PROJECT = "⚡ Activity"
ACTIVITY_PROJECT_COLOR = "#F5B700"
ACTIVITY_PROJECT_DESCRIPTION = "Notes and time entries generated from the Activity page."
NOTES_FOLDER = "notes"
DAY_FORMAT = "%Y-%m-%d"
MONTH_FORMAT = "%Y-%m"
CLOCK_FORMAT = "%H:%M"
# Activity lines of weekly and monthly prompts carry their day.
DATED_CLOCK_FORMAT = "%a %Y-%m-%d %H:%M"
KEY_SEPARATOR = "/"
MINUTES_PER_HOUR = 60
# Longest offset from UTC of a real time zone (UTC+14), in minutes.
MAX_UTC_OFFSET_MINUTES = 14 * MINUTES_PER_HOUR
MAX_INSTRUCTION_LENGTH = 2000
WEEK_DAYS = 7
CODE_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")
TITLE_LINE = re.compile(r"^# .*\n+")

Span = Literal["daily", "weekly", "monthly"]
SPANS: tuple[Span, ...] = ("daily", "weekly", "monthly")
# Context of a summary: data sources, summaries of the next shorter span, or daily summaries.
Basis = Literal["sources", "generated", "generated_daily"]
BASES: dict[Span, tuple[Basis, ...]] = {
    "daily": ("sources",),
    "weekly": ("generated", "sources"),
    "monthly": ("generated", "generated_daily", "sources"),
}
# Longest local window of a span (a month plus a DST shift).
MAX_WINDOWS: dict[Span, timedelta] = {
    "daily": timedelta(days=2),
    "weekly": timedelta(days=8),
    "monthly": timedelta(days=32),
}
SPAN_TITLES: dict[Span, str] = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}
# What a generation produces; time entries for daily requests only.
Output = Literal["summary", "time"]
OUTPUTS: tuple[Output, ...] = ("summary", "time")
SUMMARY_ONLY: tuple[Output, ...] = ("summary",)


class GenerationRequestError(ValueError):
    """Generation request is malformed (bad span, day, window, offset, context, outputs)."""


def parse_day(day: str) -> date:
    """
    Read a "YYYY-MM-DD" day

    Args:
        day (str): day
    Returns:
        date: day
    Raises:
        GenerationRequestError: malformed day
    """
    try:
        return datetime.strptime(day, DAY_FORMAT).date()
    except ValueError as error:
        raise GenerationRequestError(f"Bad day '{day}'.") from error


@dataclass(frozen=True)
class GenerationRequest:
    """What to summarize for one local day, week or month."""

    span: Span
    # First local day of the period, "YYYY-MM-DD" (the 1st for a month).
    day: str
    # Local period window in naive UTC, [start, end).
    start: datetime
    end: datetime
    # Local time minus UTC, in minutes (e.g. 60 for UTC+1).
    utc_offset_minutes: int
    basis: Basis
    # Data source keys, read when basis is "sources".
    sources: tuple[str, ...] = ()
    # Free text of the user steering the summary, "" when none.
    instruction: str = ""
    # Monthly from weekly: days no weekly summary covers use their daily summary.
    fill_daily: bool = False
    # What to generate; "time" (time entries) for daily requests only.
    outputs: tuple[Output, ...] = SUMMARY_ONLY

    def __post_init__(self) -> None:
        """
        Validate the request

        Returns:
            None
        Raises:
            GenerationRequestError: bad span, day, window, offset, context, instruction
                or outputs
        """
        if self.span not in SPANS:
            raise GenerationRequestError(f"Bad span '{self.span}'.")
        first = parse_day(self.day)
        if self.span == "monthly" and first.day != 1:
            raise GenerationRequestError("A month starts on its 1st.")
        if not self.start < self.end <= self.start + MAX_WINDOWS[self.span]:
            raise GenerationRequestError(f"Window too long for a {self.span} summary.")
        if abs(self.utc_offset_minutes) > MAX_UTC_OFFSET_MINUTES:
            raise GenerationRequestError("UTC offset out of range.")
        if self.basis not in BASES[self.span]:
            raise GenerationRequestError(f"Context '{self.basis}' not offered for {self.span}.")
        if self.basis == "sources" and not self.sources:
            raise GenerationRequestError("Pick at least one data source.")
        if len(self.instruction) > MAX_INSTRUCTION_LENGTH:
            raise GenerationRequestError(
                f"Custom instruction exceeds {MAX_INSTRUCTION_LENGTH} characters."
            )
        if not self.outputs or any(item not in OUTPUTS for item in self.outputs):
            raise GenerationRequestError("Pick a summary, time entries or both.")
        if self.span != "daily" and "time" in self.outputs:
            raise GenerationRequestError("Time entries are generated for days only.")

    @property
    def key(self) -> str:
        """
        Job key of the request

        Returns:
            str: "<span>/<day>"
        """
        return job_key(self.span, self.day)

    @property
    def days(self) -> tuple[date, ...]:
        """
        Calendar days of the period

        Returns:
            tuple[date, ...]: days, in order
        """
        return period_days(self.span, parse_day(self.day))

    def to_json(self) -> str:
        """
        Serialize for the task row

        Returns:
            str: JSON
        """
        data = asdict(self)
        data["start"], data["end"] = self.start.isoformat(), self.end.isoformat()
        return json.dumps(data)

    @classmethod
    def from_json(cls, raw: str) -> "GenerationRequest":
        """
        Read a request stored on a task row

        Args:
            raw (str): JSON written by to_json
        Returns:
            GenerationRequest: request
        Raises:
            GenerationRequestError: malformed JSON or fields
        """
        try:
            data = json.loads(raw)
            return cls(
                span=cast(Span, data.get("span", "daily")),
                day=str(data["day"]),
                start=datetime.fromisoformat(data["start"]),
                end=datetime.fromisoformat(data["end"]),
                utc_offset_minutes=int(data["utc_offset_minutes"]),
                basis=cast(Basis, data.get("basis", "sources")),
                sources=tuple(str(item) for item in data.get("sources", [])),
                instruction=str(data.get("instruction", "")),
                fill_daily=data.get("fill_daily") is True,
                outputs=tuple(cast(Output, item) for item in data.get("outputs", SUMMARY_ONLY)),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise GenerationRequestError(f"Bad stored request: {error}") from error


@dataclass(frozen=True)
class SourceSection:
    """Activities of one data source, as given to the LLM."""

    label: str
    instruction: str
    activities: tuple[Activity, ...]
    # Why the source could not be read, "" when it was.
    error: str = ""


@dataclass(frozen=True)
class SummarySection:
    """Summary already generated for a shorter period, as given to the LLM."""

    label: str
    text: str


def job_key(span: Span, day: str) -> str:
    """
    Job key of a period

    Args:
        span (Span): time span
        day (str): first day, "YYYY-MM-DD"
    Returns:
        str: "<span>/<day>"
    """
    return f"{span}{KEY_SEPARATOR}{day}"


def split_key(key: str) -> tuple[Span, str] | None:
    """
    Read a job key

    Args:
        key (str): "<span>/<day>"
    Returns:
        tuple[Span, str] | None: span and day, None when not a generation key
    """
    span, separator, day = key.partition(KEY_SEPARATOR)
    if not separator or span not in SPANS:
        return None
    return cast(Span, span), day


def period_days(span: Span, first: date) -> tuple[date, ...]:
    """
    Calendar days of the period of a span starting on a day

    Args:
        span (Span): time span
        first (date): first day (the 1st for a month)
    Returns:
        tuple[date, ...]: days, in order
    """
    if span == "daily":
        return (first,)
    if span == "weekly":
        return tuple(first + timedelta(days=offset) for offset in range(WEEK_DAYS))
    next_month = (first.replace(day=1) + timedelta(days=32)).replace(day=1)
    return tuple(first + timedelta(days=offset) for offset in range((next_month - first).days))


def period_label(span: Span, day: str) -> str:
    """
    Readable name of a period

    Args:
        span (Span): time span
        day (str): first day, "YYYY-MM-DD"
    Returns:
        str: "<day>", "Week of <day>" or "YYYY-MM"
    """
    if span == "weekly":
        return f"Week of {day}"
    if span == "monthly":
        return parse_day(day).strftime(MONTH_FORMAT)
    return day


def activity_line(activity: Activity, utc_offset_minutes: int, clock_format: str) -> str:
    """
    Render one activity for the LLM at local time

    Args:
        activity (Activity): activity (naive UTC)
        utc_offset_minutes (int): local time minus UTC, in minutes
        clock_format (str): strftime format of the moment
    Returns:
        str: "[moment] kind — title (actors): summary; key: value…" (included content only)
    """
    local = activity.occurred_at + timedelta(minutes=utc_offset_minutes)
    line = f"[{local:{clock_format}}] {activity.kind} — {activity.title}"
    if activity.actors:
        line += f" ({', '.join(activity.actors)})"
    if activity.summary:
        line += f": {activity.summary}"
    if activity.details:
        line += "; " + "; ".join(f"{key}: {value}" for key, value in activity.details.items())
    return line


def section_text(section: SourceSection, utc_offset_minutes: int, clock_format: str) -> str:
    """
    Render the activities of one source, oldest first

    Args:
        section (SourceSection): source activities
        utc_offset_minutes (int): local time minus UTC, in minutes
        clock_format (str): strftime format of each moment
    Returns:
        str: "### label" block with instruction and lines
    """
    lines = [f"### {section.label}"]
    if section.instruction:
        lines.append(f"Instruction from the user: {section.instruction}")
    if section.error:
        lines.append(f"(could not be read: {section.error})")
    ordered = sorted(section.activities, key=lambda item: item.occurred_at)
    lines += [activity_line(item, utc_offset_minutes, clock_format) for item in ordered]
    if not ordered and not section.error:
        lines.append("(nothing)")
    return "\n".join(lines)


def has_activity(sections: list[SourceSection]) -> bool:
    """
    Tell whether any source returned an activity

    Args:
        sections (list[SourceSection]): source activities
    Returns:
        bool: True when at least one activity
    """
    return any(section.activities for section in sections)


def strip_fence(answer: str) -> str:
    """
    Remove a code fence wrapped around an LLM answer

    Args:
        answer (str): raw answer
    Returns:
        str: answer without fence, trimmed
    """
    return CODE_FENCE.sub("", answer.strip()).strip()


def note_path(root: Path, span: Span, day: str) -> Path:
    """
    Path of the generated note of a period

    Args:
        root (Path): shared root
        span (Span): time span
        day (str): first day, "YYYY-MM-DD"
    Returns:
        Path: <root>/<day>/notes/<Span> activity.md
    """
    return root / day / NOTES_FOLDER / f"{SPAN_TITLES[span]} activity.md"


def note_markdown(span: Span, day: str, summary: str) -> str:
    """
    Markdown of the generated note of a period

    Args:
        span (Span): time span
        day (str): first day, "YYYY-MM-DD"
        summary (str): LLM summary
    Returns:
        str: note with its title
    """
    return f"# ⚡ {SPAN_TITLES[span]} activity — {period_label(span, day)}\n\n{strip_fence(summary)}\n"


def note_body(content: str) -> str:
    """
    Note text without its generated title line

    Args:
        content (str): note markdown
    Returns:
        str: body, trimmed
    """
    return TITLE_LINE.sub("", content, count=1).strip()

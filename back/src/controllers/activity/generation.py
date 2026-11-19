"""Activity generation: request, LLM context and answers of a daily summary / time entries."""

import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Literal, cast

from controllers.activity.base import Activity

LOGGER = logging.getLogger(__name__)

# Non-editable project holding every generated note and time entry.
ACTIVITY_PROJECT = "⚡ Activity"
ACTIVITY_PROJECT_COLOR = "#F5B700"
ACTIVITY_PROJECT_DESCRIPTION = "Notes and time entries generated from the Activity page."
NOTES_FOLDER = "notes"
DAILY_NOTE_NAME = "Daily activity.md"
DAY_FORMAT = "%Y-%m-%d"
CLOCK_FORMAT = "%H:%M"
DAILY_PREFIX = "daily/"
MINUTES_PER_HOUR = 60
# Longest offset from UTC of a real time zone (UTC+14), in minutes.
MAX_UTC_OFFSET_MINUTES = 14 * MINUTES_PER_HOUR
HOURS_DECIMALS = 2
CODE_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")

Output = Literal["summary", "time"]
OUTPUTS: tuple[Output, ...] = ("summary", "time")

SUMMARY_PROMPT = """! ACTIVITY OF {day} START !
{input}
! ACTIVITY OF {day} END !

! TASK !
You write the end-of-day journal of the user from the activity above (local times).
Group related items, name projects, people and outcomes, skip noise.
Sections: a 2-3 sentence overview, then "## Highlights" (bullets), then "## Details" per theme.
Maximum 400 words.

! FORMAT !
Respond ONLY with markdown, no title line, no code fence.
"""

TIME_PROMPT = """! ACTIVITY OF {day} START !
{input}
! ACTIVITY OF {day} END !

! PROJECTS AND TAGS !
{catalog}

! TASK !
Turn the activity above (local times) into the time entries of the user's day.
Merge items of the same task into one block; blocks must not overlap;
leave gaps where nothing happened; skip blocks shorter than 15 minutes.
Give each block the projects and tags it belongs to, chosen ONLY from the lists above
(exact names, several allowed, empty list when none fits).

! FORMAT !
Respond ONLY with a JSON array, no code fence, no text around it:
[{"start": "HH:MM", "end": "HH:MM", "title": "short title", "description": "one sentence",
  "projects": ["Project name"], "tags": ["Tag name"]}]
"""


class GenerationRequestError(ValueError):
    """Generation request is malformed (bad day, window, offset or outputs)."""


@dataclass(frozen=True)
class DailyRequest:
    """What to generate for one local day."""

    # Local day, "YYYY-MM-DD".
    day: str
    # Local day window in naive UTC, [start, end).
    start: datetime
    end: datetime
    # Local time minus UTC, in minutes (e.g. 60 for UTC+1).
    utc_offset_minutes: int
    sources: tuple[str, ...]
    outputs: tuple[Output, ...]

    def __post_init__(self) -> None:
        """
        Validate the request

        Returns:
            None
        Raises:
            GenerationRequestError: bad day, window, offset, sources or outputs
        """
        try:
            datetime.strptime(self.day, DAY_FORMAT)
        except ValueError as error:
            raise GenerationRequestError(f"Bad day '{self.day}'.") from error
        if not self.start < self.end <= self.start + timedelta(days=2):
            raise GenerationRequestError("Day window must be at most two days long.")
        if abs(self.utc_offset_minutes) > MAX_UTC_OFFSET_MINUTES:
            raise GenerationRequestError("UTC offset out of range.")
        if not self.sources:
            raise GenerationRequestError("Pick at least one data source.")
        if not self.outputs or any(item not in OUTPUTS for item in self.outputs):
            raise GenerationRequestError("Pick a summary, time entries or both.")

    @property
    def key(self) -> str:
        """
        Job key of the request

        Returns:
            str: "daily/<day>"
        """
        return daily_key(self.day)

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
    def from_json(cls, raw: str) -> "DailyRequest":
        """
        Read a request stored on a task row

        Args:
            raw (str): JSON written by to_json
        Returns:
            DailyRequest: request
        Raises:
            GenerationRequestError: malformed JSON or fields
        """
        try:
            data = json.loads(raw)
            return cls(
                day=str(data["day"]),
                start=datetime.fromisoformat(data["start"]),
                end=datetime.fromisoformat(data["end"]),
                utc_offset_minutes=int(data["utc_offset_minutes"]),
                sources=tuple(str(item) for item in data["sources"]),
                outputs=tuple(cast(Output, item) for item in data["outputs"]),
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
class Catalog:
    """Projects and tags the LLM may give to time entries."""

    # (name, description) of each project the user can pick.
    projects: tuple[tuple[str, str], ...] = ()
    tags: tuple[str, ...] = ()

    def text(self) -> str:
        """
        Render the lists for the LLM

        Returns:
            str: "Projects:" and "Tags:" bullet lists
        """
        projects = [
            f"- {name}: {description}" if description else f"- {name}"
            for name, description in self.projects
        ]
        tags = [f"- {name}" for name in self.tags]
        return "\n".join(
            ["Projects:", *(projects or ["(none)"]), "Tags:", *(tags or ["(none)"])]
        )

    def pick_projects(self, raw: object) -> tuple[str, ...]:
        """
        Keep the known projects of an LLM list (case-insensitive)

        Args:
            raw (object): JSON value
        Returns:
            tuple[str, ...]: canonical names, without duplicates
        """
        return pick_known(raw, [name for name, _ in self.projects])

    def pick_tags(self, raw: object) -> tuple[str, ...]:
        """
        Keep the known tags of an LLM list (case-insensitive)

        Args:
            raw (object): JSON value
        Returns:
            tuple[str, ...]: canonical names, without duplicates
        """
        return pick_known(raw, list(self.tags))


def pick_known(raw: object, known: list[str]) -> tuple[str, ...]:
    """
    Keep the names of a JSON list that match a known name (case-insensitive)

    Args:
        raw (object): JSON value (list of names expected)
        known (list[str]): canonical names
    Returns:
        tuple[str, ...]: canonical names, in answer order, without duplicates
    """
    if not isinstance(raw, list):
        return ()
    canonical = {name.casefold(): name for name in known}
    matches = (canonical.get(str(item).strip().casefold()) for item in raw)
    return tuple(dict.fromkeys(name for name in matches if name is not None))


@dataclass(frozen=True)
class TimeEntry:
    """Time block proposed by the LLM (local times)."""

    start: time
    end: time
    title: str
    description: str
    projects: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()

    @property
    def hours(self) -> float:
        """
        Length of the block

        Returns:
            float: hours, rounded to HOURS_DECIMALS
        """
        minutes = (self.end.hour - self.start.hour) * MINUTES_PER_HOUR + (
            self.end.minute - self.start.minute
        )
        return round(minutes / MINUTES_PER_HOUR, HOURS_DECIMALS)


def daily_key(day: str) -> str:
    """
    Job key of a day

    Args:
        day (str): "YYYY-MM-DD"
    Returns:
        str: "daily/<day>"
    """
    return f"{DAILY_PREFIX}{day}"


def activity_line(activity: Activity, utc_offset_minutes: int) -> str:
    """
    Render one activity for the LLM at local time

    Args:
        activity (Activity): activity (naive UTC)
        utc_offset_minutes (int): local time minus UTC, in minutes
    Returns:
        str: "[HH:MM] kind — title (actors): summary; key: value…" (included content only)
    """
    local = activity.occurred_at + timedelta(minutes=utc_offset_minutes)
    line = f"[{local:{CLOCK_FORMAT}}] {activity.kind} — {activity.title}"
    if activity.actors:
        line += f" ({', '.join(activity.actors)})"
    if activity.summary:
        line += f": {activity.summary}"
    if activity.details:
        line += "; " + "; ".join(f"{key}: {value}" for key, value in activity.details.items())
    return line


def section_text(section: SourceSection, utc_offset_minutes: int) -> str:
    """
    Render the activities of one source, oldest first

    Args:
        section (SourceSection): source activities
        utc_offset_minutes (int): local time minus UTC, in minutes
    Returns:
        str: "### label" block with instruction and lines
    """
    lines = [f"### {section.label}"]
    if section.instruction:
        lines.append(f"Instruction from the user: {section.instruction}")
    if section.error:
        lines.append(f"(could not be read: {section.error})")
    ordered = sorted(section.activities, key=lambda item: item.occurred_at)
    lines += [activity_line(item, utc_offset_minutes) for item in ordered]
    if not ordered and not section.error:
        lines.append("(nothing)")
    return "\n".join(lines)


def build_context(sections: list[SourceSection], utc_offset_minutes: int) -> str:
    """
    Render every source for the LLM

    Args:
        sections (list[SourceSection]): source activities
        utc_offset_minutes (int): local time minus UTC, in minutes
    Returns:
        str: blocks separated by blank lines
    """
    return "\n\n".join(section_text(item, utc_offset_minutes) for item in sections)


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


def parse_clock(value: object) -> time | None:
    """
    Read an "HH:MM" clock value

    Args:
        value (object): raw value
    Returns:
        time | None: time, None when malformed
    """
    try:
        return datetime.strptime(str(value).strip(), CLOCK_FORMAT).time()
    except ValueError:
        return None


def time_entry(item: object, catalog: Catalog) -> TimeEntry | None:
    """
    Read one proposed time block

    Args:
        item (object): JSON item
        catalog (Catalog): projects and tags allowed
    Returns:
        TimeEntry | None: block, None when malformed or not positive
    """
    if not isinstance(item, dict):
        return None
    start, end = parse_clock(item.get("start")), parse_clock(item.get("end"))
    title = str(item.get("title") or "").strip()
    if start is None or end is None or end <= start or not title:
        return None
    return TimeEntry(
        start,
        end,
        title,
        str(item.get("description") or "").strip(),
        catalog.pick_projects(item.get("projects")),
        catalog.pick_tags(item.get("tags")),
    )


def parse_time_entries(answer: str, catalog: Catalog) -> list[TimeEntry]:
    """
    Read the time blocks of an LLM answer, dropping malformed and overlapping ones

    Args:
        answer (str): raw answer (JSON array, maybe fenced)
        catalog (Catalog): projects and tags allowed (unknown names dropped)
    Returns:
        list[TimeEntry]: blocks by start time
    Raises:
        ValueError: answer is not a JSON array
    """
    try:
        data = json.loads(strip_fence(answer))
    except json.JSONDecodeError as error:
        raise ValueError(f"Time entries answer is not JSON: {error}") from error
    if not isinstance(data, list):
        raise ValueError("Time entries answer is not a JSON array.")
    entries = sorted(
        (entry for item in data if (entry := time_entry(item, catalog)) is not None),
        key=lambda entry: entry.start,
    )
    kept: list[TimeEntry] = []
    for entry in entries:
        if kept and entry.start < kept[-1].end:
            LOGGER.info("Overlapping time entry dropped: %s", entry.title)
            continue
        kept.append(entry)
    return kept


def daily_note_path(root: Path, day: str) -> Path:
    """
    Path of the generated note of a day

    Args:
        root (Path): shared root
        day (str): "YYYY-MM-DD"
    Returns:
        Path: <root>/<day>/notes/Daily activity.md
    """
    return root / day / NOTES_FOLDER / DAILY_NOTE_NAME


def daily_note(day: str, summary: str) -> str:
    """
    Markdown of the generated note of a day

    Args:
        day (str): "YYYY-MM-DD"
        summary (str): LLM summary
    Returns:
        str: note with its title
    """
    return f"# ⚡ Daily activity — {day}\n\n{strip_fence(summary)}\n"

"""Time entries of a daily generation: projects and tags catalog, LLM answer parsing."""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, time

from controllers.activity.generation import CLOCK_FORMAT, MINUTES_PER_HOUR, strip_fence

LOGGER = logging.getLogger(__name__)

HOURS_DECIMALS = 2


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
        ValueError: answer is not JSON
        TypeError: answer is not a JSON array
    """
    try:
        data = json.loads(strip_fence(answer))
    except json.JSONDecodeError as error:
        raise ValueError(f"Time entries answer is not JSON: {error}") from error
    if not isinstance(data, list):
        raise TypeError("Time entries answer is not a JSON array.")
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

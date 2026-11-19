"""Common shape of every activity data source: time range, activity record, source contract."""

import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal, TypeVar

from controllers.activity.config import ConfigField, SettingReader, SourceConfig
from controllers.activity.filters import FILTER_FIELDS, ActivityFilter
from controllers.activity.settings_io import clear_settings, write_setting
from views.settings import get_setting

MAX_RANGE = timedelta(days=31)
DEFAULT_LIMIT = 200
MAX_LIMIT = 1000
MAX_INSTRUCTION_CHARS = 2000

# active: added and on; disabled: added and off; available: set up, not added;
# inactive: not set up (e.g. no mail account); incoming: planned, not implemented.
SourceState = Literal["active", "disabled", "available", "inactive", "incoming"]
SourceOrigin = Literal["external", "athenacognis"]
JsonDict = dict[str, object]
SettingWriter = Callable[[str, object], None]
SettingsClearer = Callable[[str], None]
StepT = TypeVar("StepT")
ELAPSED_DECIMALS = 1


class InvalidRangeError(ValueError):
    """Time range is empty, reversed or too long."""


class SourceUnavailableError(RuntimeError):
    """Underlying system did not answer (e.g. server down)."""


class InvalidSettingError(ValueError):
    """A source setting cannot be used as entered (bad link, missing login…)."""


class InvalidFolderError(ValueError):
    """Folder is outside the browsable root or does not exist."""


class FolderBrowsingError(LookupError):
    """Source has no folders to browse."""


@dataclass
class ScanProgress:
    """Progress of one collect phase: steps done out of total, items found, timing."""

    # Phase shown before the bar (e.g. "Scanning").
    desc: str = ""
    # Name of the steps (e.g. "folders").
    unit: str = ""
    # Name of the items found along the way (e.g. "files"), "" when not counted.
    item_unit: str = ""
    total: int = 0
    done: int = 0
    items: int = 0
    running: bool = False
    # time.monotonic() at begin and end, 0 when not reached.
    started: float = 0.0
    finished: float = 0.0

    def begin(self, total: int) -> None:
        """
        Start the phase with its number of steps

        Args:
            total (int): steps to do
        Returns:
            None
        """
        self.total, self.done, self.running = total, 0, True
        self.started, self.finished = time.monotonic(), 0.0

    def end(self) -> None:
        """
        Stop the phase (finished or failed)

        Returns:
            None
        """
        self.running, self.finished = False, time.monotonic()

    def elapsed(self) -> float:
        """
        Seconds spent in the phase

        Returns:
            float: seconds, 0 before begin
        """
        if not self.started:
            return 0.0
        return (self.finished or time.monotonic()) - self.started

    def view(self) -> "JsonDict":
        """
        Serialize for the API

        Returns:
            JsonDict: running, desc, done, total, unit, items, item_unit, elapsed
        """
        return {
            "running": self.running,
            "desc": self.desc,
            "done": self.done,
            "total": self.total,
            "unit": self.unit,
            "items": self.items,
            "item_unit": self.item_unit,
            "elapsed": round(self.elapsed(), ELAPSED_DECIMALS),
        }


@dataclass(frozen=True)
class FolderEntry:
    """Subfolder shown by a folder picker."""

    name: str
    path: str
    has_children: bool

    def view(self) -> "JsonDict":
        """
        Serialize for the API

        Returns:
            JsonDict: name, path relative to the root, has_children
        """
        return {"name": self.name, "path": self.path, "has_children": self.has_children}


def to_naive_utc(moment: datetime) -> datetime:
    """
    Convert a datetime to naive UTC (DB convention); naive input is taken as UTC

    Args:
        moment (datetime): datetime
    Returns:
        datetime: naive UTC datetime
    """
    if moment.tzinfo is None:
        return moment
    return moment.astimezone(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class TimeRange:
    """Half-open time window [start, end) in naive UTC."""

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        """
        Normalize to naive UTC and validate the window

        Returns:
            None
        Raises:
            InvalidRangeError: start not before end, or window longer than MAX_RANGE
        """
        object.__setattr__(self, "start", to_naive_utc(self.start))
        object.__setattr__(self, "end", to_naive_utc(self.end))
        if self.start >= self.end:
            raise InvalidRangeError("Range start must be before its end.")
        if self.end - self.start > MAX_RANGE:
            raise InvalidRangeError(f"Range cannot exceed {MAX_RANGE.days} days.")

    def contains(self, moment: datetime) -> bool:
        """
        Tell whether a moment falls inside the window

        Args:
            moment (datetime): moment
        Returns:
            bool: True when start <= moment < end
        """
        return self.start <= to_naive_utc(moment) < self.end


@dataclass(frozen=True)
class Activity:
    """One thing that happened, normalized across sources, rich enough for a day summary."""

    id: str
    source: str
    kind: str
    occurred_at: datetime
    title: str
    summary: str = ""
    actors: tuple[str, ...] = ()
    link: str | None = None
    details: dict[str, str] = field(default_factory=dict)

    def ai_context(self) -> str:
        """
        Render the activity as one plain-text line for an LLM day summary

        Returns:
            str: "[HH:MM] source/kind — title (actors): summary; key=value…"
        """
        line = f"[{self.occurred_at:%H:%M}] {self.source}/{self.kind} — {self.title}"
        if self.actors:
            line += f" ({', '.join(self.actors)})"
        if self.summary:
            line += f": {self.summary}"
        if self.details:
            line += "; " + ", ".join(
                f"{key}={value}" for key, value in self.details.items()
            )
        return line

    def view(self) -> JsonDict:
        """
        Serialize for the API

        Returns:
            JsonDict: activity fields plus ai_context
        """
        return {
            "id": self.id,
            "source": self.source,
            "kind": self.kind,
            "occurred_at": self.occurred_at.isoformat(),
            "title": self.title,
            "summary": self.summary,
            "actors": list(self.actors),
            "link": self.link,
            "details": dict(self.details),
            "ai_context": self.ai_context(),
        }


@dataclass(frozen=True)
class SourceDescriptor:
    """Catalog entry of a source: identity and how it shows in the UI."""

    key: str
    label: str
    icon: str
    description: str
    origin: SourceOrigin = "external"


@dataclass(frozen=True)
class SourceInfo:
    """Descriptor plus live state of a source."""

    descriptor: SourceDescriptor
    state: SourceState
    detail: str
    setup_link: str | None = None
    # User instruction for the AI when it summarizes this source.
    instruction: str = ""
    # Serialized config fields (see ConfigField.view).
    config: tuple[JsonDict, ...] = ()

    def view(self) -> JsonDict:
        """
        Serialize for the API

        Returns:
            JsonDict: descriptor fields, state, detail and setup link
        """
        return {
            "key": self.descriptor.key,
            "label": self.descriptor.label,
            "icon": self.descriptor.icon,
            "description": self.descriptor.description,
            "origin": self.descriptor.origin,
            "state": self.state,
            "detail": self.detail,
            "setup_link": self.setup_link,
            "instruction": self.instruction,
            "config": list(self.config),
        }


class DataSource(ABC):
    """Contract of an implemented source: state, and activities for a time range."""

    descriptor: SourceDescriptor
    setup_link: str | None = None
    read_setting: SettingReader = staticmethod(get_setting)
    write_setting: SettingWriter = staticmethod(write_setting)
    clear_settings: SettingsClearer = staticmethod(clear_settings)

    @property
    def key(self) -> str:
        """
        Source key

        Returns:
            str: unique key
        """
        return self.descriptor.key

    @abstractmethod
    def is_configured(self) -> bool:
        """
        Tell whether the underlying system is set up (e.g. a mail account exists)

        Returns:
            bool: True when connected
        """

    @abstractmethod
    def detail(self) -> str:
        """
        Describe the current connection in a few words (e.g. "2 accounts")

        Returns:
            str: short status text
        """

    # Latest collect phase, set by track() (or a source scanning by itself).
    _progress: ScanProgress | None = None

    def progress(self) -> ScanProgress:
        """
        Progress of the latest collect phase

        Returns:
            ScanProgress: latest phase, idle when none ran
        """
        return self._progress or ScanProgress()

    def track(self, steps: Sequence[StepT], desc: str, unit: str) -> Iterator[StepT]:
        """
        Yield the steps of a collect phase, publishing its progress (like tqdm)

        Args:
            steps (Sequence[StepT]): steps of the phase
            desc (str): phase name (e.g. "Reading calendars")
            unit (str): step name (e.g. "calendars")
        Returns:
            Iterator[StepT]: the steps, in order
        """
        progress = ScanProgress(desc=desc, unit=unit)
        self._progress = progress
        progress.begin(len(steps))
        try:
            for step in steps:
                yield step
                progress.done += 1
        finally:
            progress.end()

    def browse(self, path: str) -> list[FolderEntry]:
        """
        List the subfolders of a folder for a "folders" field picker

        Args:
            path (str): folder relative to the source root ("" for the root)
        Returns:
            list[FolderEntry]: subfolders
        Raises:
            FolderBrowsingError: source has no folders field (default)
        """
        raise FolderBrowsingError(f"Data source '{self.key}' has no folders to browse.")

    @abstractmethod
    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the raw activities of the window from the underlying system

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: activities, any order
        """

    def info(self) -> SourceInfo:
        """
        Describe the source and its state

        Returns:
            SourceInfo: descriptor, state, detail and instruction
        """
        return SourceInfo(
            self.descriptor,
            self.state(),
            self.detail(),
            self.setup_link,
            self.instruction(),
            tuple(item.view(self.setting_prefix) for item in self.view_fields()),
        )

    def config_fields(self) -> list[ConfigField]:
        """
        Declare the settings of this source (rendered by the Activity page)

        Returns:
            list[ConfigField]: fields, none by default
        """
        return []

    def all_config_fields(self) -> list[ConfigField]:
        """
        Source settings followed by the shared regex filters

        Returns:
            list[ConfigField]: fields
        """
        return [*self.config_fields(), *FILTER_FIELDS]

    def view_fields(self) -> list[ConfigField]:
        """
        Fields shown in the UI (may add live data such as suggestions)

        Returns:
            list[ConfigField]: all config fields by default
        """
        return self.all_config_fields()

    def config(self) -> SourceConfig:
        """
        Read the settings of this source

        Returns:
            SourceConfig: typed reads with defaults
        """
        return SourceConfig(
            self.all_config_fields(), self.read_setting, self.setting_prefix
        )

    def setting_key(self, name: str) -> str:
        """
        Setting key of this source

        Args:
            name (str): setting name (e.g. "enabled")
        Returns:
            str: "activity_<key>_<name>"
        """
        return f"{self.setting_prefix}{name}"

    @property
    def setting_prefix(self) -> str:
        """
        Prefix shared by every setting of this source

        Returns:
            str: "activity_<key>_"
        """
        return f"activity_{self.key}_"

    def state(self) -> SourceState:
        """
        Compute the state from setup, "added" and "enabled" settings

        Returns:
            SourceState: active, disabled, available or inactive
        """
        if not self.is_configured():
            return "inactive"
        if self.read_setting(self.setting_key("added")) is not True:
            return "available"
        if self.read_setting(self.setting_key("enabled")) is False:
            return "disabled"
        return "active"

    def add(self) -> None:
        """
        Add the source to the Activity page, enabled

        Returns:
            None
        """
        self.write_setting(self.setting_key("added"), True)
        self.write_setting(self.setting_key("enabled"), True)

    def set_enabled(self, is_enabled: bool) -> None:
        """
        Turn an added source on or off

        Args:
            is_enabled (bool): new state
        Returns:
            None
        """
        self.write_setting(self.setting_key("enabled"), is_enabled)

    def remove(self) -> None:
        """
        Remove the source from the Activity page and reset its settings

        Returns:
            None
        """
        self.clear_settings(self.setting_prefix)

    @property
    def instruction_setting(self) -> str:
        """
        Setting key of the user instruction of this source

        Returns:
            str: "activity_<key>_instruction"
        """
        return self.setting_key("instruction")

    def instruction(self) -> str:
        """
        User instruction for the AI summarizing this source (trimmed, capped)

        Returns:
            str: instruction, empty when unset
        """
        value = self.read_setting(self.instruction_setting)
        text = value.strip() if isinstance(value, str) else ""
        return text[:MAX_INSTRUCTION_CHARS]

    def activities(
        self, window: TimeRange, limit: int = DEFAULT_LIMIT
    ) -> list[Activity]:
        """
        Return the activities of the window, newest first, clipped to the window and limit

        Args:
            window (TimeRange): time window
            limit (int): maximum number of activities (1..MAX_LIMIT)
        Returns:
            list[Activity]: normalized feed, passed through the regex filters
        Raises:
            ValueError: limit out of bounds
            InvalidFilterError: a regex filter does not compile
        """
        if not 1 <= limit <= MAX_LIMIT:
            raise ValueError(f"Limit must be between 1 and {MAX_LIMIT}.")
        if self.state() != "active":
            return []
        keep = ActivityFilter.from_config(self.config())
        inside = [
            item
            for item in self.collect(window)
            if window.contains(item.occurred_at) and keep.keeps(item)
        ]
        inside.sort(key=lambda item: item.occurred_at, reverse=True)
        return inside[:limit]

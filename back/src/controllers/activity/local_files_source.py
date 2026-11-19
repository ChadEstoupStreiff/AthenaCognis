"""Local file changes data source: files modified in folders picked inside LOCAL_PATH."""

import logging
import os
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from controllers.activity.base import (
    Activity,
    DataSource,
    FolderEntry,
    InvalidFolderError,
    ScanProgress,
    SourceDescriptor,
    TimeRange,
)
from controllers.activity.config import ConfigField, SourceConfig

LOGGER = logging.getLogger(__name__)

LOCAL_FILES_DESCRIPTOR = SourceDescriptor(
    "local_files",
    "Local file changes",
    "pi pi-folder",
    "Files created or edited in watched folders.",
)
# LOCAL_PATH of .env, mounted read-only by docker-compose.
LOCAL_ROOT = Path("/local")
MAX_LISTED_FOLDERS = 1000
MAX_SCANNED_FILES = 200_000
MAX_CHANGES = 1000
BYTES_PER_KB = 1024
SIZE_UNITS = ("B", "KB", "MB", "GB")
HIDDEN_PREFIX = "."
PARENT_PART = ".."
# Dependency, cache, VCS and system folders: noise, and slow to walk (hidden or not).
SKIPPED_DIRS = frozenset(
    {
        "node_modules",
        "__pycache__",
        "site-packages",
        "venv",
        ".git",
        "Library",
        "$RECYCLE.BIN",
    }
)
# Office lock files and editor / download leftovers.
SKIPPED_FILE_PREFIXES = ("~$",)
SKIPPED_FILE_SUFFIXES = ("~", ".swp", ".tmp", ".crdownload", ".part")
EXTENSION_SEPARATORS = re.compile(r"[\s,;]+")


def parse_extensions(text: str) -> frozenset[str]:
    """
    Read an extension list such as "pdf, .docx md"

    Args:
        text (str): extensions separated by commas, semicolons or spaces
    Returns:
        frozenset[str]: lowercase extensions without dot
    """
    parts = (
        part.strip().lstrip(".").lower() for part in EXTENSION_SEPARATORS.split(text)
    )
    return frozenset(part for part in parts if part)


def extension_of(name: str) -> str:
    """
    Extension of a file name

    Args:
        name (str): file name
    Returns:
        str: lowercase extension without dot, empty when none
    """
    return PurePosixPath(name).suffix.lstrip(".").lower()


@dataclass(frozen=True)
class ScanRules:
    """Which folders and files the picker and the scan keep."""

    include_hidden_files: bool = False
    include_hidden_folders: bool = False
    only_extensions: frozenset[str] = frozenset()
    skip_extensions: frozenset[str] = frozenset()

    @classmethod
    def from_config(cls, config: SourceConfig) -> "ScanRules":
        """
        Read the scan settings

        Args:
            config (SourceConfig): local files settings
        Returns:
            ScanRules: rules
        """
        return cls(
            config.flag("include_hidden_files"),
            config.flag("include_hidden_folders"),
            parse_extensions(config.text("only_extensions")),
            parse_extensions(config.text("skip_extensions")),
        )

    def skips_dir(self, name: str) -> bool:
        """
        Tell whether a folder is left out of the picker and the scan

        Args:
            name (str): folder name
        Returns:
            bool: True for skipped folders, and hidden ones unless included
        """
        if name in SKIPPED_DIRS:
            return True
        return name.startswith(HIDDEN_PREFIX) and not self.include_hidden_folders

    def skips_file(self, name: str) -> bool:
        """
        Tell whether a file is left out (hidden, lock, temporary or filtered extension)

        Args:
            name (str): file name
        Returns:
            bool: True when left out
        """
        if name.startswith(HIDDEN_PREFIX) and not self.include_hidden_files:
            return True
        if name.startswith(SKIPPED_FILE_PREFIXES) or name.endswith(
            SKIPPED_FILE_SUFFIXES
        ):
            return True
        extension = extension_of(name)
        if self.only_extensions and extension not in self.only_extensions:
            return True
        return extension in self.skip_extensions


def resolve_folder(root: Path, relative: str) -> Path:
    """
    Turn a picked folder into a real folder inside the root

    Args:
        root (Path): LOCAL_PATH mount
        relative (str): path below the root ("" for the root itself)
    Returns:
        Path: folder (below root)
    Raises:
        InvalidFolderError: absolute, climbing (".."), through a symlink, or not a folder
    """
    pure = PurePosixPath(relative)
    if pure.is_absolute() or PARENT_PART in pure.parts:
        raise InvalidFolderError(f"Folder '{relative}' is outside LOCAL_PATH.")
    folder = root.joinpath(*pure.parts)
    if folder.resolve() != root.resolve().joinpath(*pure.parts) or not folder.is_dir():
        raise InvalidFolderError(f"Folder '{relative}' does not exist in LOCAL_PATH.")
    return folder


def subfolders(
    folder: Path, rules: ScanRules, limit: int | None = MAX_LISTED_FOLDERS
) -> list[Path]:
    """
    Real (non-symlink) subfolders kept by the rules, empty when unreadable

    Args:
        folder (Path): folder
        rules (ScanRules): scan rules
        limit (int | None): maximum count, None for all
    Returns:
        list[Path]: subfolders sorted by name
    """
    try:
        with os.scandir(folder) as entries:
            found = [
                Path(entry.path)
                for entry in entries
                if entry.is_dir(follow_symlinks=False)
                and not rules.skips_dir(entry.name)
            ]
    except OSError:
        return []
    return sorted(found, key=lambda path: path.name.lower())[:limit]


def folder_entries(root: Path, relative: str, rules: ScanRules) -> list[FolderEntry]:
    """
    List the subfolders of a folder for the picker

    Args:
        root (Path): LOCAL_PATH mount
        relative (str): folder below the root ("" for the root)
        rules (ScanRules): scan rules (hidden folders)
    Returns:
        list[FolderEntry]: subfolders with their relative path
    Raises:
        InvalidFolderError: folder outside the root or missing
    """
    folder = resolve_folder(root, relative)
    return [
        FolderEntry(
            child.name,
            child.relative_to(root).as_posix(),
            bool(subfolders(child, rules)),
        )
        for child in subfolders(folder, rules)
    ]


@dataclass(frozen=True)
class ScanUnit:
    """Step of a scan: files directly in a folder, or a whole subfolder tree."""

    folder: Path
    is_recursive: bool


def scan_units(folder: Path, rules: ScanRules) -> list[ScanUnit]:
    """
    Split a picked folder into progress steps: its own files, then each subfolder

    Args:
        folder (Path): picked folder
        rules (ScanRules): scan rules
    Returns:
        list[ScanUnit]: steps
    """
    children = subfolders(folder, rules, limit=None)
    return [ScanUnit(folder, False), *(ScanUnit(child, True) for child in children)]


def top_files(folder: Path, rules: ScanRules) -> Iterator[Path]:
    """
    Yield the files directly in a folder kept by the rules

    Args:
        folder (Path): folder
        rules (ScanRules): scan rules
    Returns:
        Iterator[Path]: files
    """
    try:
        with os.scandir(folder) as entries:
            names = [
                entry.name for entry in entries if entry.is_file(follow_symlinks=False)
            ]
    except OSError:
        return
    yield from (folder / name for name in names if not rules.skips_file(name))


def tree_files(folder: Path, rules: ScanRules) -> Iterator[Path]:
    """
    Yield the files under a folder kept by the rules, symlinks not followed

    Args:
        folder (Path): folder to walk
        rules (ScanRules): scan rules
    Returns:
        Iterator[Path]: files
    """
    for current, dirs, files in os.walk(folder):
        dirs[:] = [name for name in dirs if not rules.skips_dir(name)]
        for name in files:
            if not rules.skips_file(name):
                yield Path(current) / name


def unit_files(unit: ScanUnit, rules: ScanRules) -> Iterator[Path]:
    """
    Yield the files of one scan step

    Args:
        unit (ScanUnit): step
        rules (ScanRules): scan rules
    Returns:
        Iterator[Path]: files
    """
    if unit.is_recursive:
        return tree_files(unit.folder, rules)
    return top_files(unit.folder, rules)


@dataclass(frozen=True)
class FileChange:
    """File modified inside the window."""

    relative: str
    modified_at: datetime
    size: int


def change_of(root: Path, file: Path) -> FileChange | None:
    """
    Read the modification time and size of a file

    Args:
        root (Path): LOCAL_PATH mount
        file (Path): file
    Returns:
        FileChange | None: change, None when the file vanished or is unreadable
    """
    try:
        stat = file.stat(follow_symlinks=False)
    except OSError:
        return None
    modified_at = datetime.fromtimestamp(stat.st_mtime, UTC).replace(tzinfo=None)
    return FileChange(file.relative_to(root).as_posix(), modified_at, stat.st_size)


@dataclass(frozen=True)
class ScanJob:
    """Inputs of one scan."""

    root: Path
    window: TimeRange
    rules: ScanRules


def scan_unit(
    job: ScanJob, unit: ScanUnit, seen: set[Path], progress: ScanProgress
) -> list[FileChange]:
    """
    Scan one step, counting files and skipping those already seen

    Args:
        job (ScanJob): scan inputs
        unit (ScanUnit): step
        seen (set[Path]): files already scanned (picked folders may nest), updated
        progress (ScanProgress): progress, updated
    Returns:
        list[FileChange]: changes inside the window
    """
    changes: list[FileChange] = []
    for file in unit_files(unit, job.rules):
        if len(seen) >= MAX_SCANNED_FILES:
            break
        if file in seen:
            continue
        seen.add(file)
        progress.items += 1
        change = change_of(job.root, file)
        if change is not None and job.window.contains(change.modified_at):
            changes.append(change)
    return changes


def changed_files(
    job: ScanJob, folders: Sequence[Path], progress: ScanProgress
) -> list[FileChange]:
    """
    Find the files of the picked folders modified inside the window

    Args:
        job (ScanJob): scan inputs
        folders (Sequence[Path]): picked folders
        progress (ScanProgress): progress, updated step by step
    Returns:
        list[FileChange]: changes, newest first, at most MAX_CHANGES
            (scan stops after MAX_SCANNED_FILES files)
    """
    units = [unit for folder in folders for unit in scan_units(folder, job.rules)]
    progress.begin(len(units))
    seen: set[Path] = set()
    changes: list[FileChange] = []
    try:
        for unit in units:
            changes += scan_unit(job, unit, seen, progress)
            progress.done += 1
    finally:
        progress.end()
    changes.sort(key=lambda change: change.modified_at, reverse=True)
    return changes[:MAX_CHANGES]


def size_text(size: int) -> str:
    """
    Format a file size

    Args:
        size (int): bytes
    Returns:
        str: "N B", "N.N KB", "N.N MB" or "N.N GB"
    """
    value = float(size)
    for unit in SIZE_UNITS[:-1]:
        if value < BYTES_PER_KB:
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= BYTES_PER_KB
    return f"{value:.1f} {SIZE_UNITS[-1]}"


def change_activity(change: FileChange) -> Activity:
    """
    Build the activity of one modified file

    Args:
        change (FileChange): change
    Returns:
        Activity: normalized activity (summary = folder path)
    """
    path = PurePosixPath(change.relative)
    details = {"size": size_text(change.size)}
    extension = extension_of(path.name)
    if extension:
        details["type"] = extension
    return Activity(
        id=f"local_files:{change.relative}:{change.modified_at:%Y%m%dT%H%M%S}",
        source=LOCAL_FILES_DESCRIPTOR.key,
        kind="modified",
        occurred_at=change.modified_at,
        title=path.name,
        summary=path.parent.as_posix(),
        details=details,
    )


class LocalFilesDataSource(DataSource):
    """Files modified in folders picked inside the LOCAL_PATH mount."""

    descriptor = LOCAL_FILES_DESCRIPTOR
    root: Path = LOCAL_ROOT

    def is_configured(self) -> bool:
        """
        Tell whether LOCAL_PATH is mounted

        Returns:
            bool: True when the mount folder exists
        """
        return self.root.is_dir()

    def picked_folders(self) -> list[Path]:
        """
        Picked folders that still exist inside the root (others are skipped)

        Returns:
            list[Path]: folders
        """
        folders: list[Path] = []
        for relative in self.config().strings("folders"):
            try:
                folders.append(resolve_folder(self.root, relative))
            except InvalidFolderError as error:
                LOGGER.warning("Skipping watched folder: %s", error)
        return folders

    def detail(self) -> str:
        """
        Describe the mount and the picked folders

        Returns:
            str: setup hint, "No folder picked" or "N folder(s)"
        """
        if not self.is_configured():
            return f"Set LOCAL_PATH in .env (mounted at {self.root})"
        count = len(self.picked_folders())
        if count == 0:
            return "No folder picked"
        return f"{count} folder{'s' if count != 1 else ''}"

    def config_fields(self) -> list[ConfigField]:
        """
        Declare watched folders, hidden files and folders, and extension filters

        Returns:
            list[ConfigField]: fields
        """
        return [
            ConfigField(
                "folders",
                "Watched folders",
                "Folders inside LOCAL_PATH, subfolders included. "
                "Dependency, cache and .git folders are always skipped.",
                "folders",
                (),
            ),
            ConfigField(
                "include_hidden_files",
                "Include hidden files",
                "Files starting with a dot (e.g. .env).",
                "toggle",
                False,
            ),
            ConfigField(
                "include_hidden_folders",
                "Include hidden folders",
                "Folders starting with a dot (e.g. .config), in the scan and the picker.",
                "toggle",
                False,
            ),
            ConfigField(
                "only_extensions",
                "Only these extensions",
                "E.g. pdf, docx, md. Empty: every extension.",
                "text",
                "",
            ),
            ConfigField(
                "skip_extensions",
                "Skip these extensions",
                "E.g. log, lock, pyc. Empty: skip none.",
                "text",
                "",
            ),
        ]

    def browse(self, path: str) -> list[FolderEntry]:
        """
        List the subfolders of a folder inside LOCAL_PATH for the folder picker

        Args:
            path (str): folder below the root ("" for the root)
        Returns:
            list[FolderEntry]: subfolders
        Raises:
            InvalidFolderError: folder outside LOCAL_PATH or missing
        """
        return folder_entries(self.root, path, ScanRules.from_config(self.config()))

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the files of the picked folders modified in the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per modified file
        """
        job = ScanJob(self.root, window, ScanRules.from_config(self.config()))
        # Latest scan owns the progress shown in the UI.
        progress = ScanProgress(desc="Scanning", unit="folders", item_unit="files")
        self._progress = progress
        changes = changed_files(job, self.picked_folders(), progress)
        return [change_activity(change) for change in changes]

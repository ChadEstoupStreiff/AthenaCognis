"""Version history of notes: snapshots kept outside the dated folders of /shared."""

import re
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

SHARED_ROOT = Path("/shared")
HISTORY_FOLDER = ".history"
MIN_SNAPSHOT_INTERVAL = timedelta(minutes=5)
MAX_SNAPSHOTS = 200
SNAPSHOT_SUFFIX = ".snapshot"
STAMP_FORMAT = "%Y%m%dT%H%M%S%f"
SNAPSHOT_ID_PATTERN = re.compile(r"^\d{8}T\d{12}$")

Clock = Callable[[], datetime]


class NoteHistoryError(ValueError):
    """Raised for a note path or snapshot id the history refuses."""


@dataclass(frozen=True)
class Snapshot:
    """One saved version of a note."""

    id: str
    created_at: datetime
    size: int

    def view(self) -> dict[str, object]:
        """
        Serialize the snapshot for the API

        Returns:
            dict[str, object]: id, ISO creation time and size in bytes
        """
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "size": self.size,
        }


class NoteHistory:
    """Snapshots stored under /shared/.history/<date>/<folder>/<name>/ (never indexed)."""

    def __init__(
        self,
        shared_root: Path = SHARED_ROOT,
        clock: Clock = datetime.now,
        min_interval: timedelta = MIN_SNAPSHOT_INTERVAL,
        max_snapshots: int = MAX_SNAPSHOTS,
    ) -> None:
        """
        Configure where and how often snapshots are kept

        Args:
            shared_root (Path): root of user files
            clock (Clock): current time provider
            min_interval (timedelta): minimum age of the latest snapshot before a new one
            max_snapshots (int): snapshots kept per note (oldest pruned)
        Returns:
            None
        """
        self.shared_root = shared_root
        self.history_root = shared_root / HISTORY_FOLDER
        self.clock = clock
        self.min_interval = min_interval
        self.max_snapshots = max_snapshots

    def folder(self, note: Path) -> Path:
        """
        History folder of a note

        Args:
            note (Path): note path under the shared root
        Returns:
            Path: folder holding its snapshots
        Raises:
            NoteHistoryError: path outside the shared root or inside the history
        """
        resolved = note.resolve()
        root = self.shared_root.resolve()
        if not resolved.is_relative_to(root) or resolved.is_relative_to(
            self.history_root.resolve()
        ):
            raise NoteHistoryError(f"{note} is not a shared file.")
        return self.history_root / resolved.relative_to(root)

    def snapshots(self, note: Path) -> list[Snapshot]:
        """
        Snapshots of a note, newest first

        Args:
            note (Path): note path
        Returns:
            list[Snapshot]: snapshots
        """
        folder = self.folder(note)
        if not folder.is_dir():
            return []
        snapshots = [
            self._snapshot_of(path) for path in folder.glob(f"*{SNAPSHOT_SUFFIX}")
        ]
        valid = [snapshot for snapshot in snapshots if snapshot is not None]
        return sorted(valid, key=lambda snapshot: snapshot.id, reverse=True)

    def read(self, note: Path, snapshot_id: str) -> str:
        """
        Content of one snapshot

        Args:
            note (Path): note path
            snapshot_id (str): snapshot id
        Returns:
            str: UTF-8 content
        Raises:
            NoteHistoryError: malformed id
            FileNotFoundError: unknown snapshot
        """
        if not SNAPSHOT_ID_PATTERN.match(snapshot_id):
            raise NoteHistoryError(f"Invalid snapshot id {snapshot_id}.")
        path = self.folder(note) / f"{snapshot_id}{SNAPSHOT_SUFFIX}"
        return path.read_text(encoding="utf-8")

    def snapshot(self, note: Path, force: bool = False) -> Snapshot | None:
        """
        Save the current content of a note when it changed and the last snapshot is old enough

        Args:
            note (Path): note path
            force (bool): ignore the minimum interval
        Returns:
            Snapshot | None: new snapshot, None when skipped
        Raises:
            FileNotFoundError: missing note
        """
        content = note.read_bytes()
        folder = self.folder(note)
        snapshots = self.snapshots(note)
        now = self.clock()
        if snapshots and self._is_skippable(note, snapshots[0], content, now, force):
            return None
        folder.mkdir(parents=True, exist_ok=True)
        snapshot_id = now.strftime(STAMP_FORMAT)
        (folder / f"{snapshot_id}{SNAPSHOT_SUFFIX}").write_bytes(content)
        self._prune(folder, [snapshot_id, *[snapshot.id for snapshot in snapshots]])
        return Snapshot(snapshot_id, now, len(content))

    def move(self, old_note: Path, new_note: Path) -> None:
        """
        Follow a renamed or moved note

        Args:
            old_note (Path): previous path
            new_note (Path): new path
        Returns:
            None
        """
        source = self.folder(old_note)
        target = self.folder(new_note)
        if source.is_dir() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))

    def _is_skippable(
        self, note: Path, latest: Snapshot, content: bytes, now: datetime, force: bool
    ) -> bool:
        """
        Whether a new snapshot would add nothing

        Args:
            note (Path): note path
            latest (Snapshot): newest snapshot
            content (bytes): current content
            now (datetime): current time
            force (bool): ignore the minimum interval
        Returns:
            bool: True when identical to the latest or too soon after it
        """
        latest_path = self.folder(note) / f"{latest.id}{SNAPSHOT_SUFFIX}"
        if latest_path.read_bytes() == content:
            return True
        return not force and now - latest.created_at < self.min_interval

    def _prune(self, folder: Path, ids_newest_first: list[str]) -> None:
        """
        Delete snapshots beyond the limit

        Args:
            folder (Path): history folder
            ids_newest_first (list[str]): snapshot ids, newest first
        Returns:
            None
        """
        for snapshot_id in ids_newest_first[self.max_snapshots :]:
            (folder / f"{snapshot_id}{SNAPSHOT_SUFFIX}").unlink(missing_ok=True)

    def _snapshot_of(self, path: Path) -> Snapshot | None:
        """
        Snapshot described by a file

        Args:
            path (Path): snapshot file
        Returns:
            Snapshot | None: snapshot, None for foreign files
        """
        snapshot_id = path.name.removesuffix(SNAPSHOT_SUFFIX)
        if not SNAPSHOT_ID_PATTERN.match(snapshot_id):
            return None
        created_at = datetime.strptime(snapshot_id, STAMP_FORMAT)
        return Snapshot(snapshot_id, created_at, path.stat().st_size)

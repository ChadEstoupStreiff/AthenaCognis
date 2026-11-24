from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import views.note_history
from controllers.note_history import NoteHistory, NoteHistoryError

START = datetime(2026, 11, 24, 9, 0, 0)


class FakeClock:
    """Manually advanced clock"""

    def __init__(self) -> None:
        """
        Start at a fixed time

        Returns:
            None
        """
        self.now = START

    def __call__(self) -> datetime:
        """
        Current fake time

        Returns:
            datetime: current time
        """
        return self.now

    def advance(self, minutes: int) -> None:
        """
        Move the clock forward

        Args:
            minutes (int): minutes to add
        Returns:
            None
        """
        self.now += timedelta(minutes=minutes)


@pytest.fixture
def clock() -> FakeClock:
    """
    Fresh fake clock

    Returns:
        FakeClock: clock
    """
    return FakeClock()


@pytest.fixture
def note(tmp_path: Path) -> Path:
    """
    Note file under a fake shared root

    Args:
        tmp_path (Path): pytest temporary folder
    Returns:
        Path: note path
    """
    path = tmp_path / "2026-11-24" / "notes" / "meeting.md"
    path.parent.mkdir(parents=True)
    path.write_text("# v1\n", encoding="utf-8")
    return path


def make_history(
    tmp_path: Path, clock: FakeClock, max_snapshots: int = 200
) -> NoteHistory:
    """
    History rooted in the temporary folder

    Args:
        tmp_path (Path): fake shared root
        clock (FakeClock): clock
        max_snapshots (int): snapshot limit
    Returns:
        NoteHistory: history
    """
    return NoteHistory(tmp_path, clock, timedelta(minutes=5), max_snapshots)


def test_snapshot_stores_outside_dated_folders(
    tmp_path: Path, clock: FakeClock, note: Path
) -> None:
    history = make_history(tmp_path, clock)
    snapshot = history.snapshot(note)
    assert snapshot is not None
    assert (
        history.folder(note)
        == tmp_path / ".history" / "2026-11-24" / "notes" / "meeting.md"
    )
    assert history.read(note, snapshot.id) == "# v1\n"


def test_unchanged_content_is_skipped_even_when_forced(
    tmp_path: Path, clock: FakeClock, note: Path
) -> None:
    history = make_history(tmp_path, clock)
    history.snapshot(note)
    clock.advance(10)
    assert history.snapshot(note, force=True) is None


def test_recent_snapshot_skips_unless_forced(
    tmp_path: Path, clock: FakeClock, note: Path
) -> None:
    history = make_history(tmp_path, clock)
    history.snapshot(note)
    note.write_text("# v2\n", encoding="utf-8")
    clock.advance(1)
    assert history.snapshot(note) is None
    assert history.snapshot(note, force=True) is not None


def test_list_is_newest_first_and_pruned(
    tmp_path: Path, clock: FakeClock, note: Path
) -> None:
    history = make_history(tmp_path, clock, max_snapshots=2)
    for version in range(3):
        note.write_text(f"# v{version}\n", encoding="utf-8")
        history.snapshot(note)
        clock.advance(10)
    snapshots = history.snapshots(note)
    assert len(snapshots) == 2
    assert history.read(note, snapshots[0].id) == "# v2\n"
    assert snapshots[0].created_at > snapshots[1].created_at


def test_move_follows_the_note(tmp_path: Path, clock: FakeClock, note: Path) -> None:
    history = make_history(tmp_path, clock)
    snapshot = history.snapshot(note)
    assert snapshot is not None
    renamed = note.with_name("renamed.md")
    note.rename(renamed)
    history.move(note, renamed)
    assert history.read(renamed, snapshot.id) == "# v1\n"


@pytest.mark.parametrize("path", ["/etc/passwd", "../outside.md"])
def test_paths_outside_shared_are_refused(
    tmp_path: Path, clock: FakeClock, path: str
) -> None:
    with pytest.raises(NoteHistoryError):
        make_history(tmp_path, clock).folder(
            tmp_path / path if path.startswith("..") else Path(path)
        )


def test_malformed_snapshot_id_is_refused(
    tmp_path: Path, clock: FakeClock, note: Path
) -> None:
    with pytest.raises(NoteHistoryError):
        make_history(tmp_path, clock).read(note, "../../etc/passwd")


def test_routes(
    tmp_path: Path, clock: FakeClock, note: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(views.note_history, "history", make_history(tmp_path, clock))
    app = FastAPI()
    app.include_router(views.note_history.router)
    client = TestClient(app)
    created = client.post(f"/note-history/snapshot/{note}").json()["snapshot"]
    assert client.get(f"/note-history/list/{note}").json()[0]["id"] == created["id"]
    read = client.get(
        f"/note-history/read/{note}", params={"snapshot_id": created["id"]}
    )
    assert read.json()["content"] == "# v1\n"
    assert (
        client.get(
            f"/note-history/read/{note}", params={"snapshot_id": "bad"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/note-history/snapshot/{note.with_name('missing.md')}"
        ).status_code
        == 404
    )

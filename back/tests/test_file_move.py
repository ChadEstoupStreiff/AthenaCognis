import asyncio
from pathlib import Path

import pytest

import views.files as files_view
from db.models import PinnedFile
from tests.conftest import SessionFactory

OLD_PATH = "/shared/2026-11-25/notes/Draft.md"
NEW_PATH = "/shared/2026-11-25/notes/Final.md"
MOVED_MANAGERS = (
    "SummarizeManager",
    "DocumentTreeManager",
    "OCRManager",
    "TranscriptionManager",
    "PreviewManager",
    "NoteManager",
)


def stub_filesystem(monkeypatch: pytest.MonkeyPatch, factory: SessionFactory) -> None:
    """
    Make move_file run without touching disk or per-file managers

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        factory (SessionFactory): test database sessions
    Returns:
        None
    """
    monkeypatch.setattr(files_view, "get_db", factory)
    monkeypatch.setattr(files_view.os.path, "exists", lambda path: path == OLD_PATH)
    monkeypatch.setattr(files_view.os, "makedirs", lambda *args, **kwargs: None)
    monkeypatch.setattr(files_view.os, "rename", lambda source, target: None)
    monkeypatch.setattr(files_view, "follow_note_move", lambda source, target: None)
    for manager in MOVED_MANAGERS:
        monkeypatch.setattr(getattr(files_view, manager), "move", lambda source, target: None)


def test_move_keeps_pin(monkeypatch: pytest.MonkeyPatch, session_factory: SessionFactory) -> None:
    """
    Keep a pinned file pinned after rename

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        session_factory (SessionFactory): test database sessions
    Returns:
        None
    """
    stub_filesystem(monkeypatch, session_factory)
    with session_factory() as db:
        db.add(PinnedFile(file=OLD_PATH))
        db.commit()

    result = asyncio.run(files_view.move_file(OLD_PATH, name=Path(NEW_PATH).name))

    assert result == NEW_PATH
    with session_factory() as db:
        assert [row.file for row in db.query(PinnedFile).all()] == [NEW_PATH]

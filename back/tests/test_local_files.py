import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import views.activity
from controllers.activity import local_files_source
from controllers.activity.base import DataSource, InvalidFolderError, TimeRange
from controllers.activity.local_files_source import (
    LocalFilesDataSource,
    parse_extensions,
    resolve_folder,
    size_text,
)

DAY = datetime(2026, 11, 18)
WINDOW = TimeRange(DAY, DAY + timedelta(days=1))
Settings = dict[str, object]


def write(root: Path, relative: str, moment: datetime, size: int = 10) -> Path:
    """
    Create a file with a given modification time

    Args:
        root (Path): LOCAL_PATH stand-in
        relative (str): path below the root
        moment (datetime): naive UTC modification time
        size (int): content length
    Returns:
        Path: file
    """
    file = root / relative
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(b"x" * size)
    stamp = moment.replace(tzinfo=UTC).timestamp()
    os.utime(file, (stamp, stamp))
    return file


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """
    Point the source to a temporary LOCAL_PATH with a few files

    Args:
        tmp_path (Path): pytest temporary directory
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Path: root
    """
    monkeypatch.setattr(LocalFilesDataSource, "root", tmp_path)
    write(tmp_path, "Documents/Work/report.docx", DAY.replace(hour=10), 2048)
    write(tmp_path, "Documents/Work/deep/notes.md", DAY.replace(hour=11))
    write(tmp_path, "Documents/Work/old.txt", DAY - timedelta(days=2))
    write(tmp_path, "Documents/Work/~$report.docx", DAY.replace(hour=10))
    write(tmp_path, "Documents/Work/.DS_Store", DAY.replace(hour=10))
    write(tmp_path, "Documents/Work/node_modules/lib.js", DAY.replace(hour=10))
    write(tmp_path, "Documents/Work/.git/index", DAY.replace(hour=10))
    write(tmp_path, "Code/app.py", DAY.replace(hour=9))
    write(tmp_path, "Library/Caches/x.db", DAY.replace(hour=9))
    write(tmp_path, "Code/.env", DAY.replace(hour=9))
    write(tmp_path, ".config/app/settings.json", DAY.replace(hour=9))
    (tmp_path / "Code" / "link").symlink_to(tmp_path / "Documents")
    return tmp_path


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """
    Replace the data source settings with an editable dict, source added

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Settings: settings
    """
    values: Settings = {
        "activity_local_files_added": True,
        # Every content field but the text excerpt (checked on its own).
        "activity_local_files_include": [
            item.key
            for item in LocalFilesDataSource().content_fields()
            if item.key != "content"
        ],
    }
    monkeypatch.setattr(DataSource, "read_setting", staticmethod(values.get))
    return values


def test_browse_walks_folders_without_noise(root: Path, settings: Settings) -> None:
    source = LocalFilesDataSource()
    top = [entry.view() for entry in source.browse("")]
    assert top == [
        {"name": "Code", "path": "Code", "has_children": False},
        {"name": "Documents", "path": "Documents", "has_children": True},
    ]
    assert [entry.path for entry in source.browse("Documents/Work")] == [
        "Documents/Work/deep"
    ]
    settings["activity_local_files_include_hidden_folders"] = True
    assert [entry.name for entry in source.browse("")] == [
        ".config",
        "Code",
        "Documents",
    ]
    assert [entry.name for entry in source.browse("Documents/Work")] == ["deep"]


def test_resolve_folder_stays_inside_root(root: Path) -> None:
    assert resolve_folder(root, "Documents/Work") == root / "Documents" / "Work"
    assert resolve_folder(root, "") == root
    for bad in ("..", "Documents/../..", "/etc", "Code/link", "missing"):
        with pytest.raises(InvalidFolderError):
            resolve_folder(root, bad)


def test_browse_route(root: Path, settings: Settings) -> None:
    app = FastAPI()
    app.include_router(views.activity.router)
    client = TestClient(app)
    url = "/activity/sources/local_files/folders"
    assert client.get(url, params={"path": "Documents"}).json() == [
        {"name": "Work", "path": "Documents/Work", "has_children": True}
    ]
    assert client.get(url, params={"path": "../.."}).status_code == 400
    assert client.get("/activity/sources/mail/folders").status_code == 409


def test_feed_lists_modified_files_of_picked_folders(
    root: Path, settings: Settings
) -> None:
    source = LocalFilesDataSource()
    assert source.detail() == "No folder picked"
    assert source.activities(WINDOW) == []
    settings["activity_local_files_folders"] = ["Documents", "Documents/Work"]
    assert source.detail() == "2 folders"
    feed = source.activities(WINDOW)
    assert [(item.title, item.summary) for item in feed] == [
        ("notes.md", "Documents/Work/deep"),
        ("report.docx", "Documents/Work"),
    ]
    assert feed[1].occurred_at == DAY.replace(hour=10)
    assert feed[1].details == {"size": "2.0 KB", "type": "docx", "path": "Documents/Work/report.docx"}


def test_text_excerpt_only_when_included(root: Path, settings: Settings) -> None:
    settings["activity_local_files_folders"] = ["Documents"]
    feed = LocalFilesDataSource().activities(WINDOW)
    assert all("content" not in item.details for item in feed)
    included = [*settings["activity_local_files_include"], "content"]  # type: ignore[misc]
    settings["activity_local_files_include"] = included
    by_title = {item.title: item for item in LocalFilesDataSource().activities(WINDOW)}
    assert by_title["notes.md"].details["content"].startswith("xxx")
    assert "content" not in by_title["report.docx"].details


def test_unknown_or_outside_folders_are_ignored(root: Path, settings: Settings) -> None:
    settings["activity_local_files_folders"] = ["..", "/etc", "missing", "Code/link"]
    source = LocalFilesDataSource()
    assert source.detail() == "No folder picked"
    assert source.activities(WINDOW) == []


def test_hidden_files_folders_and_extensions(root: Path, settings: Settings) -> None:
    settings["activity_local_files_folders"] = ["", "Documents"]
    source = LocalFilesDataSource()
    titles = [item.title for item in source.activities(WINDOW)]
    assert titles == ["notes.md", "report.docx", "app.py"]
    settings["activity_local_files_include_hidden_files"] = True
    titles = [item.title for item in source.activities(WINDOW)]
    assert ".env" in titles
    assert ".DS_Store" in titles
    assert "settings.json" not in titles
    settings["activity_local_files_include_hidden_folders"] = True
    paths = [item.summary for item in source.activities(WINDOW)]
    assert ".config/app" in paths
    assert not any(".git" in path or "node_modules" in path for path in paths)
    settings["activity_local_files_only_extensions"] = ".MD, docx; py"
    settings["activity_local_files_skip_extensions"] = "py"
    assert [item.title for item in source.activities(WINDOW)] == [
        "notes.md",
        "report.docx",
    ]


def test_parse_extensions() -> None:
    assert parse_extensions(" .PDF, docx;md  txt ") == {"pdf", "docx", "md", "txt"}
    assert parse_extensions("") == frozenset()


def test_not_mounted(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(LocalFilesDataSource, "root", Path("/nonexistent-local"))
    source = LocalFilesDataSource()
    assert source.state() == "inactive"
    assert source.detail().startswith("Set LOCAL_PATH in .env")
    assert source.info().config[0]["kind"] == "folders"


def test_size_text() -> None:
    assert size_text(512) == "512 B"
    assert size_text(1536) == "1.5 KB"
    assert size_text(5 * 1024**3) == "5.0 GB"


IDLE_PROGRESS: dict[str, object] = {
    "running": False,
    "desc": "",
    "done": 0,
    "total": 0,
    "unit": "",
    "items": 0,
    "item_unit": "",
    "elapsed": 0.0,
}


def test_scan_reports_progress(
    root: Path, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings["activity_local_files_folders"] = ["Documents"]
    source = LocalFilesDataSource()
    assert source.progress().view() == IDLE_PROGRESS
    seen_running: list[dict[str, object]] = []
    original = local_files_source.change_of

    def spy(base: Path, file: Path) -> local_files_source.FileChange | None:
        """
        Record the progress while a file is read

        Args:
            base (Path): root
            file (Path): file
        Returns:
            local_files_source.FileChange | None: real result
        """
        seen_running.append(source.progress().view())
        return original(base, file)

    monkeypatch.setattr(local_files_source, "change_of", spy)
    source.activities(WINDOW)
    # Documents: its own files, then the Work subfolder.
    assert seen_running[0]["running"] is True
    assert seen_running[0]["total"] == 2
    final = source.progress().view()
    assert {key: final[key] for key in ("running", "done", "total", "items")} == {
        "running": False,
        "done": 2,
        "total": 2,
        "items": 3,
    }
    assert (final["desc"], final["unit"], final["item_unit"]) == (
        "Scanning",
        "folders",
        "files",
    )
    assert isinstance(final["elapsed"], float)


def test_progress_route(root: Path, settings: Settings) -> None:
    app = FastAPI()
    app.include_router(views.activity.router)
    client = TestClient(app)
    response = client.get("/activity/sources/mail/progress")
    assert response.json() == IDLE_PROGRESS
    assert client.get("/activity/sources/nope/progress").status_code == 404

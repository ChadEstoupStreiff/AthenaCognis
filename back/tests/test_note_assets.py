from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import views.note_assets
from controllers import note_assets
from controllers.note_assets import (
    NoteAssetError,
    asset_url,
    is_note_asset,
    move_note_assets,
    raw_prefixes,
    rewrite_asset_links,
    safe_asset_name,
    save_note_asset,
)


def make_note(root: Path, name: str, content: str) -> Path:
    """
    Note with an assets folder holding one image

    Args:
        root (Path): fake shared root
        name (str): note file name
        content (str): note content
    Returns:
        Path: note path
    """
    note = root / "2026-11-24" / "notes" / name
    assets = note.parent / note.stem / "assets"
    assets.mkdir(parents=True)
    (assets / "a.png").write_bytes(b"png")
    note.write_text(content, encoding="utf-8")
    return note


def test_raw_prefixes_cover_both_encodings(tmp_path: Path) -> None:
    folder = tmp_path / "2026-11-24" / "notes" / "Plan (v1)"
    assert raw_prefixes(folder, tmp_path) == [
        "/raw/2026-11-24/notes/Plan%20(v1)/",
        "/raw/2026-11-24/notes/Plan%20%28v1%29/",
    ]


def test_rewrite_asset_links(tmp_path: Path) -> None:
    old = tmp_path / "2026-11-24" / "notes" / "Plan (v1).md"
    new = tmp_path / "2026-11-25" / "notes" / "Final.md"
    content = "![a](/raw/2026-11-24/notes/Plan%20%28v1%29/assets/a.png) /raw/2026-11-24/notes/Plan%20(v1)/x"
    assert rewrite_asset_links(content, old, new, tmp_path) == (
        "![a](/raw/2026-11-25/notes/Final/assets/a.png) /raw/2026-11-25/notes/Final/x"
    )


def test_move_note_assets_moves_folder_and_links(tmp_path: Path) -> None:
    old = make_note(tmp_path, "old.md", "![a](/raw/2026-11-24/notes/old/assets/a.png)")
    new = old.with_name("new.md")
    old.rename(new)
    assert move_note_assets(old, new, tmp_path) is True
    assert (new.parent / "new" / "assets" / "a.png").read_bytes() == b"png"
    assert not (old.parent / "old").exists()
    assert (
        new.read_text(encoding="utf-8")
        == "![a](/raw/2026-11-24/notes/new/assets/a.png)"
    )


def test_note_without_assets_is_ignored(tmp_path: Path) -> None:
    note = tmp_path / "2026-11-24" / "notes" / "plain.md"
    note.parent.mkdir(parents=True)
    note.write_text("x", encoding="utf-8")
    assert move_note_assets(note, note.with_name("other.md"), tmp_path) is False


def test_existing_target_folder_is_refused(tmp_path: Path) -> None:
    old = make_note(tmp_path, "old.md", "")
    (old.parent / "new").mkdir()
    new = old.with_name("new.md")
    old.rename(new)
    with pytest.raises(FileExistsError):
        move_note_assets(old, new, tmp_path)


def test_is_note_asset(tmp_path: Path) -> None:
    asset = tmp_path / "2026-11-24" / "notes" / "n" / "assets" / "a.png"
    assert is_note_asset(asset, tmp_path) is True
    assert is_note_asset(tmp_path / "2026-11-24" / "notes" / "n.md", tmp_path) is False
    assert (
        is_note_asset(tmp_path / "2026-11-24" / "uploads" / "assets", tmp_path) is False
    )
    assert is_note_asset("/elsewhere/a/b/c/assets/x", tmp_path) is False


def test_save_note_asset_stores_beside_note_without_clobbering(tmp_path: Path) -> None:
    note = make_note(tmp_path, "n.md", "")
    first = save_note_asset(note, "b.png", BytesIO(b"1"), tmp_path)
    second = save_note_asset(note, "b.png", BytesIO(b"2"), tmp_path)
    assert first == note.parent / "n" / "assets" / "b.png"
    assert second.name == "b-1.png"
    assert first.read_bytes() == b"1"
    assert asset_url(second, tmp_path) == "/raw/2026-11-24/notes/n/assets/b-1.png"


@pytest.mark.parametrize("name", ["", "..", "/"])
def test_unusable_names_are_refused(name: str) -> None:
    with pytest.raises(NoteAssetError):
        safe_asset_name(name)


def test_names_lose_folders_and_unsafe_characters() -> None:
    assert safe_asset_name("../../x/a:b?.png") == "a_b_.png"


def test_assets_need_an_existing_note(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        save_note_asset(
            tmp_path / "2026-11-24" / "notes" / "x.md", "a", BytesIO(), tmp_path
        )
    with pytest.raises(NoteAssetError):
        save_note_asset(Path("/etc/passwd"), "a", BytesIO(), tmp_path)


def test_upload_route(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    note = make_note(tmp_path, "n.md", "")
    monkeypatch.setattr(note_assets, "SHARED_ROOT", tmp_path)
    monkeypatch.setattr(
        views.note_assets,
        "save_note_asset",
        lambda path, name, source: save_note_asset(path, name, source, tmp_path),
    )
    monkeypatch.setattr(
        views.note_assets, "asset_url", lambda path: asset_url(path, tmp_path)
    )
    app = FastAPI()
    app.include_router(views.note_assets.router)
    client = TestClient(app)
    response = client.post(
        f"/note-assets/{note}", files={"file": ("shot.png", b"img", "image/png")}
    )
    assert response.json()["url"] == "/raw/2026-11-24/notes/n/assets/shot.png"
    missing = client.post(
        f"/note-assets/{note.with_name('x.md')}",
        files={"file": ("a", b"", "text/plain")},
    )
    assert missing.status_code == 404

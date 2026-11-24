"""Assets of a note (/shared/<date>/notes/<note name>/assets) follow the note when it moves."""

import re
import shutil
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote

SHARED_ROOT = Path("/shared")
ASSETS_FOLDER = "assets"
RAW_PREFIX = "/raw/"
# encodeURIComponent keeps these; the editor also escapes parentheses in Markdown links.
URI_COMPONENT_SAFE = "!'()*"
MARKDOWN_LINK_SAFE = "!'*"
TEXT_ENCODING = "utf-8"
NOTE_PATH_DEPTH = 3  # <date>/<folder>/<name>
ASSET_PATH_MIN_DEPTH = 5  # <date>/<folder>/<note>/assets/<file>
ASSETS_INDEX = 3
UNSAFE_NAME_CHARACTERS = re.compile(r"[\\/:?*\"<>|\x00-\x1f]")
MAX_NAME_ATTEMPTS = 1000


class NoteAssetError(ValueError):
    """Raised for a note path or file name the asset store refuses."""


def is_note_asset(path: str | Path, shared_root: Path = SHARED_ROOT) -> bool:
    """
    Whether a file is an asset of a note (hidden from the library and AI processing)

    Args:
        path (str | Path): absolute file path
        shared_root (Path): root of user files
    Returns:
        bool: True for /shared/<date>/<folder>/<note>/assets/...
    """
    try:
        parts = Path(path).relative_to(shared_root).parts
    except ValueError:
        return False
    return len(parts) >= ASSET_PATH_MIN_DEPTH and parts[ASSETS_INDEX] == ASSETS_FOLDER


def safe_asset_name(name: str) -> str:
    """
    File name stripped of folders and characters unsafe on disk or in URLs

    Args:
        name (str): requested name
    Returns:
        str: sanitized name
    Raises:
        NoteAssetError: nothing usable left
    """
    cleaned = UNSAFE_NAME_CHARACTERS.sub("_", Path(name).name).strip(" .")
    if not cleaned:
        raise NoteAssetError(f"Invalid file name {name!r}.")
    return cleaned


def note_assets_dir(note: Path, shared_root: Path = SHARED_ROOT) -> Path:
    """
    Validated assets directory of a note

    Args:
        note (Path): note path
        shared_root (Path): root of user files
    Returns:
        Path: /shared/<date>/<folder>/<note stem>/assets
    Raises:
        NoteAssetError: path outside /shared/<date>/<folder>/<name>
        FileNotFoundError: missing note
    """
    resolved = note.resolve()
    root = shared_root.resolve()
    if not resolved.is_relative_to(root):
        raise NoteAssetError(f"{note} is not a shared file.")
    if len(resolved.relative_to(root).parts) != NOTE_PATH_DEPTH:
        raise NoteAssetError(f"{note} is not a note.")
    if not resolved.is_file():
        raise FileNotFoundError(f"{note} does not exist.")
    return asset_folder(resolved) / ASSETS_FOLDER


def free_path(folder: Path, name: str) -> Path:
    """
    First unused path for a name in a folder (name-1.ext, name-2.ext…)

    Args:
        folder (Path): target folder
        name (str): wanted name
    Returns:
        Path: free path
    Raises:
        NoteAssetError: no free name found
    """
    candidate = folder / name
    stem, suffix = Path(name).stem, Path(name).suffix
    for attempt in range(1, MAX_NAME_ATTEMPTS):
        if not candidate.exists():
            return candidate
        candidate = folder / f"{stem}-{attempt}{suffix}"
    raise NoteAssetError(f"No free name for {name}.")


def save_note_asset(
    note: Path, name: str, source: BinaryIO, shared_root: Path = SHARED_ROOT
) -> Path:
    """
    Store a file in the assets folder of a note (no indexing, OCR or summary)

    Args:
        note (Path): note path
        name (str): requested file name
        source (BinaryIO): file content
        shared_root (Path): root of user files
    Returns:
        Path: stored file
    """
    folder = note_assets_dir(note, shared_root)
    folder.mkdir(parents=True, exist_ok=True)
    target = free_path(folder, safe_asset_name(name))
    with target.open("wb") as destination:
        shutil.copyfileobj(source, destination)
    return target


def asset_url(path: Path, shared_root: Path = SHARED_ROOT) -> str:
    """
    Inline URL of a stored asset (served by nginx under /raw)

    Args:
        path (Path): asset path
        shared_root (Path): root of user files
    Returns:
        str: URL encoded like encodeURIComponent
    """
    parts = path.resolve().relative_to(shared_root.resolve()).parts
    return RAW_PREFIX + "/".join(quote(part, safe=URI_COMPONENT_SAFE) for part in parts)


def asset_folder(note: Path) -> Path:
    """
    Folder holding the assets of a note

    Args:
        note (Path): note path
    Returns:
        Path: <note folder>/<note stem>
    """
    return note.parent / note.stem


def raw_prefixes(folder: Path, shared_root: Path = SHARED_ROOT) -> list[str]:
    """
    URL prefixes the editor writes for files of a folder (both encodings)

    Args:
        folder (Path): asset folder under the shared root
        shared_root (Path): root of user files
    Returns:
        list[str]: distinct /raw/... prefixes ending with a slash
    """
    parts = folder.relative_to(shared_root).parts
    prefixes = [
        RAW_PREFIX + "/".join(quote(part, safe=safe) for part in parts) + "/"
        for safe in (URI_COMPONENT_SAFE, MARKDOWN_LINK_SAFE)
    ]
    return list(dict.fromkeys(prefixes))


def rewrite_asset_links(
    content: str, old_note: Path, new_note: Path, shared_root: Path = SHARED_ROOT
) -> str:
    """
    Point asset links of a note to its new asset folder

    Args:
        content (str): note content
        old_note (Path): previous note path
        new_note (Path): new note path
        shared_root (Path): root of user files
    Returns:
        str: content with rewritten links
    """
    new_prefix = raw_prefixes(asset_folder(new_note), shared_root)[0]
    for old_prefix in raw_prefixes(asset_folder(old_note), shared_root):
        content = content.replace(old_prefix, new_prefix)
    return content


def move_note_assets(
    old_note: Path, new_note: Path, shared_root: Path = SHARED_ROOT
) -> bool:
    """
    Move the asset folder of a moved note and fix the links inside the note

    Args:
        old_note (Path): previous note path
        new_note (Path): new note path (already moved)
        shared_root (Path): root of user files
    Returns:
        bool: True when assets were moved
    Raises:
        FileExistsError: the target asset folder already exists
    """
    source = asset_folder(old_note)
    target = asset_folder(new_note)
    if not (source / ASSETS_FOLDER).is_dir() or source == target:
        return False
    if target.exists():
        raise FileExistsError(f"{target} already exists.")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
    content = new_note.read_text(encoding=TEXT_ENCODING)
    rewritten = rewrite_asset_links(content, old_note, new_note, shared_root)
    if rewritten != content:
        new_note.write_text(rewritten, encoding=TEXT_ENCODING)
    return True

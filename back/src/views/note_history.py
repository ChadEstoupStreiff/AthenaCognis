"""Note history routes: snapshot, list and read versions of a note."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException

from controllers.note_history import NoteHistory, NoteHistoryError

HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404

router = APIRouter(prefix="/note-history", tags=["Note history"])
history = NoteHistory()

JsonDict = dict[str, object]


@contextmanager
def http_errors() -> Iterator[None]:
    """
    Map history errors to HTTP errors

    Returns:
        Iterator[None]: context
    Raises:
        HTTPException: 400 refused path or id, 404 missing note or snapshot
    """
    try:
        yield
    except NoteHistoryError as error:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(
            status_code=HTTP_NOT_FOUND, detail="Note or snapshot not found."
        ) from error


@router.post("/snapshot/{file:path}")
def take_snapshot(file: str, force: bool = False) -> JsonDict:
    """
    Save the current note content as a version (skipped when unchanged or too recent)

    Args:
        file (str): note path
        force (bool): ignore the minimum interval between snapshots
    Returns:
        JsonDict: {"snapshot": view or None}
    """
    with http_errors():
        snapshot = history.snapshot(Path(file), force)
    return {"snapshot": None if snapshot is None else snapshot.view()}


@router.get("/list/{file:path}")
def list_snapshots(file: str) -> list[JsonDict]:
    """
    Versions of a note, newest first

    Args:
        file (str): note path
    Returns:
        list[JsonDict]: snapshots
    """
    with http_errors():
        snapshots = history.snapshots(Path(file))
    return [snapshot.view() for snapshot in snapshots]


@router.get("/read/{file:path}")
def read_snapshot(file: str, snapshot_id: str) -> JsonDict:
    """
    Content of one version

    Args:
        file (str): note path
        snapshot_id (str): snapshot id
    Returns:
        JsonDict: {"id", "content"}
    """
    with http_errors():
        content = history.read(Path(file), snapshot_id)
    return {"id": snapshot_id, "content": content}

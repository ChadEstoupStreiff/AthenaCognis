"""Note asset routes: files pasted or attached in a note, kept out of the library."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

from controllers.note_assets import NoteAssetError, asset_url, save_note_asset

HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404

router = APIRouter(prefix="/note-assets", tags=["Note assets"])

JsonDict = dict[str, object]


@router.post("/{note:path}")
def upload_note_asset(note: str, file: UploadFile) -> JsonDict:
    """
    Store a file in the assets folder of a note (no library entry, OCR, summary or preview)

    Args:
        note (str): note path
        file (UploadFile): uploaded file
    Returns:
        JsonDict: {"path", "url"}
    Raises:
        HTTPException: 400 refused path or name, 404 missing note
    """
    try:
        stored = save_note_asset(Path(note), file.filename or "", file.file)
    except NoteAssetError as error:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=HTTP_NOT_FOUND, detail=str(error)) from error
    return {"path": str(stored), "url": asset_url(stored)}

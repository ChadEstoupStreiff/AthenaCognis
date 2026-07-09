import logging
import traceback

from controllers.NoteManager import NoteManager
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/notes", tags=["Notes"])


@router.get("/{file:path}")
async def get_notes(file: str):
    """
    Get the status of the notes processing.
    """
    try:
        return NoteManager.get(file)
    except Exception as e:
        logging.error(f"Error retrieving notes status for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving notes status for {file}: {str(e)}",
        )


@router.post("/{file:path}")
async def set_notes(file: str, note: str):
    """
    Set the notes for a specific file.
    """
    try:
        NoteManager.set(file, note)
        return {"message": "Notes updated successfully."}
    except Exception as e:
        logging.error(f"Error setting notes for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error setting notes for {file}: {str(e)}"
        )

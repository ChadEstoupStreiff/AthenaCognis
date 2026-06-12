import logging
import mimetypes
import os
import traceback

from controllers.PreviewManager import PreviewManager
from fastapi import APIRouter, HTTPException
from starlette.responses import FileResponse

router = APIRouter(prefix="/preview", tags=["Preview"])


@router.get("/health")
async def health():
    return "RUNNING"


@router.get("/running")
async def running():
    return PreviewManager.in_progress_file


@router.get("/tasks")
async def list_tasks():
    return PreviewManager.list_tasks()


@router.get("/tasks/{file:path}")
async def get_tasks(file: str):
    return PreviewManager.get_tasks(file)


@router.post("/generate/{file:path}")
async def generate_preview(file: str):
    try:
        PreviewManager.add_file_to_queue(file)
        return {"message": "Preview generation queued."}
    except Exception as e:
        logging.error(f"Error queuing preview for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file:path}")
async def get_preview(file: str):
    preview_path = PreviewManager.get_preview_path(file)
    if preview_path is None or not os.path.exists(preview_path):
        raise HTTPException(status_code=404, detail="No preview available.")

    mime, _ = mimetypes.guess_type(preview_path)
    if not mime:
        mime = "application/octet-stream"

    return FileResponse(preview_path, media_type=mime)

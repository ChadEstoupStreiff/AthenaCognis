import logging
import os
import traceback

from controllers.TranscriptionManager import TranscriptionManager
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/transcription", tags=["Transcription"])


@router.get("/running")
async def get_running_transcription():
    """
    Get the list of currently running transcription tasks.
    """
    try:
        return TranscriptionManager.in_progress_file
    except Exception as e:
        logging.error(f"Error retrieving running transcription tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving running transcription tasks: {str(e)}",
        )


@router.get("/get/{file:path}")
async def get_transcription_status(file: str):
    """
    Get the status of the transcription processing.
    """
    try:
        return TranscriptionManager.get(file)
    except Exception as e:
        logging.error(f"Error retrieving transcription status for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving transcription status for {file}: {str(e)}",
        )


@router.get("/tasks/{file:path}")
async def get_transcription_task(file: str):
    """
    Get the transcription task details for a specific file.
    """
    try:
        return TranscriptionManager.get_tasks(file)
    except Exception as e:
        logging.error(f"Error retrieving transcription task for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving transcription task for {file}: {str(e)}",
        )


@router.get("/tasks")
async def list_transcription_tasks():
    """
    List all transcription tasks.
    """
    try:
        return TranscriptionManager.list_tasks()
    except Exception as e:
        logging.error(f"Error listing transcription tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error listing transcription tasks: {str(e)}"
        )


@router.post("/ask/{file:path}")
async def launch_transcription(file: str):
    """
    Launch transcription processing for a specific file.
    """
    if not os.path.exists(file):
        raise HTTPException(status_code=404, detail=f"File {file} does not exist.")

    try:
        TranscriptionManager.add_file_to_queue(file)
        return {"message": f"Transcription launched for {file}."}
    except Exception as e:
        logging.error(f"Error launching transcription for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error launching transcription for {file}: {str(e)}",
        )

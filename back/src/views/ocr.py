import logging
import os
import traceback

from controllers.OCRManager import OCRManager
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/ocr", tags=["OCR"])


@router.get("/running")
async def get_running_ocr():
    """
    Get the list of currently running OCR tasks.
    """
    try:
        return OCRManager.in_progess_file
    except Exception as e:
        logging.error(f"Error retrieving running OCR tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving running OCR tasks: {str(e)}"
        )


@router.get("/get/{file:path}")
async def get_ocr_status(file: str):
    """
    Get the status of the OCR processing.
    """
    try:
        return OCRManager.get(file)
    except Exception as e:
        logging.error(f"Error retrieving OCR status for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving OCR status for {file}: {str(e)}"
        )


@router.get("/tasks/{file:path}")
async def get_ocr_task(file: str):
    """
    Get the OCR task details for a specific file.
    """
    try:
        return OCRManager.get_tasks(file)
    except Exception as e:
        logging.error(f"Error retrieving OCR task for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving OCR task for {file}: {str(e)}"
        )


@router.get("/tasks")
async def list_ocr_tasks():
    """
    List all OCR tasks.
    """
    try:
        return OCRManager.list_tasks()
    except Exception as e:
        logging.error(f"Error listing OCR tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error listing OCR tasks: {str(e)}"
        )


@router.post("/ask/{file:path}")
async def launch_ocr(file: str):
    """
    Launch OCR processing for a specific file.
    """
    if not os.path.exists(file):
        raise HTTPException(status_code=404, detail=f"File {file} not found.")
    try:
        OCRManager.add_file_to_queue(file)
        return {"message": f"OCR processing for {file} has been launched."}
    except Exception as e:
        logging.error(f"Error launching OCR for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error launching OCR for {file}: {str(e)}"
        )

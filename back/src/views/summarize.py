import logging
import traceback

from controllers.SummarizeManager import SummarizeManager
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/summarize", tags=["Summarize"])


@router.get("/running")
async def get_running_summarize():
    """
    Get the list of currently running summarization tasks.
    """
    try:
        return SummarizeManager.in_progress_file
    except Exception as e:
        logging.error(f"Error retrieving running summarization tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving running summarization tasks: {str(e)}",
        )


@router.get("/get/{file:path}")
async def get_summarize(file: str):
    """
    Get the status of the summarization processing.
    """
    try:
        return SummarizeManager.get(file)
    except Exception as e:
        logging.error(f"Error retrieving summarization status for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving summarization status for {file}: {str(e)}",
        )


@router.get("/tasks/{file:path}")
async def get_summarize_task(file: str):
    """
    Get the summarization task details for a specific file.
    """
    try:
        return SummarizeManager.get_tasks(file)
    except Exception as e:
        logging.error(f"Error retrieving summarization task for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving summarization task for {file}: {str(e)}",
        )


@router.get("/tasks")
async def list_summarize_tasks():
    """
    List all summarization tasks.
    """
    try:
        return SummarizeManager.list_tasks()
    except Exception as e:
        logging.error(f"Error listing summarization tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error listing summarization tasks: {str(e)}"
        )


@router.post("/ask/{file:path}")
async def launch_summarize(file: str):
    """
    Launch summarization processing for a specific file.
    """
    try:
        SummarizeManager.add_file_to_queue(file)
        return {"message": f"Summarization launched for {file}."}
    except Exception as e:
        logging.error(f"Error launching summarization for {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error launching summarization for {file}: {str(e)}",
        )

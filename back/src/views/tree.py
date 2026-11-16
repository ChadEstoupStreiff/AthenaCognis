import logging
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from controllers.DocumentTreeManager import (
    DEFAULT_MAX_DEPTH,
    DEFAULT_MAX_SECTIONS,
    DEFAULT_MIN_WORDS,
    DocumentBlocks,
    DocumentTreeManager,
    TreeInputError,
    TreeParams,
    TreeParamsError,
    TreeRecord,
)
from controllers.JobManager import JobAlreadyQueuedError, JobTaskInfo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tree", tags=["Document tree"])

HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


class TreeRequest(BaseModel):
    """Body of a tree generation request."""

    max_depth: int = DEFAULT_MAX_DEPTH
    max_sections: int = DEFAULT_MAX_SECTIONS
    min_words: int = DEFAULT_MIN_WORDS
    focus: str = ""
    auto_depth: bool = True
    auto_sections: bool = True


def require_file(file: str) -> None:
    """
    Fail with 404 when a file does not exist

    Args:
        file (str): file path
    Returns:
        None
    Raises:
        HTTPException: 404 when missing
    """
    if not Path(file).exists():
        raise HTTPException(status_code=HTTP_NOT_FOUND, detail=f"File {file} does not exist.")


@router.get("/health")
async def health() -> str:
    """
    Get the tree daemon health

    Returns:
        str: RUNNING when the daemon thread is alive, DEAD otherwise
    """
    return "RUNNING" if DocumentTreeManager.is_alive() else "DEAD"


@router.get("/running")
async def running() -> Optional[str]:
    """
    Get the file whose tree is being generated

    Returns:
        Optional[str]: file path, None when idle
    """
    return DocumentTreeManager.in_progress_file


@router.get("/tasks")
async def list_tasks() -> List[JobTaskInfo]:
    """
    List every tree task

    Returns:
        List[JobTaskInfo]: runs, newest first
    """
    return DocumentTreeManager.list_tasks()


@router.get("/tasks/{file:path}")
async def file_tasks(file: str) -> List[JobTaskInfo]:
    """
    List the tree tasks of a file

    Args:
        file (str): file path
    Returns:
        List[JobTaskInfo]: runs, newest first
    """
    return DocumentTreeManager.get_tasks(file)


@router.get("/get/{file:path}", response_model=None)
async def get_tree(file: str) -> Optional[TreeRecord]:
    """
    Get the stored tree of a file

    Args:
        file (str): file path
    Returns:
        Optional[TreeRecord]: tree, None when never generated
    """
    return DocumentTreeManager.get(file)


@router.get("/blocks/{file:path}", response_model=None)
async def get_blocks(file: str) -> DocumentBlocks:
    """
    Get every block of a file, the targets of the tree ranges

    Args:
        file (str): file path
    Returns:
        DocumentBlocks: blocks
    Raises:
        HTTPException: 404 when missing, 400 when the file has no text
    """
    require_file(file)
    try:
        return DocumentTreeManager.blocks(file)
    except TreeInputError as error:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail=str(error)) from error


@router.post("/ask/{file:path}")
async def ask_tree(file: str, body: Optional[TreeRequest] = None) -> Dict[str, str]:
    """
    Queue a tree generation for a file

    Args:
        file (str): file path
        body (Optional[TreeRequest]): generation parameters, defaults when absent
    Returns:
        Dict[str, str]: confirmation message
    Raises:
        HTTPException: 404 missing file, 400 bad parameters, 409 already queued
    """
    require_file(file)
    request = body or TreeRequest()
    try:
        params = TreeParams(**request.dict())
        DocumentTreeManager.request(file, params)
    except TreeParamsError as error:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail=str(error)) from error
    except JobAlreadyQueuedError as error:
        raise HTTPException(status_code=HTTP_CONFLICT, detail=str(error)) from error
    logger.info(f"TREE >> Requested for {file} with {params}")
    return {"message": f"Tree generation launched for {file}."}

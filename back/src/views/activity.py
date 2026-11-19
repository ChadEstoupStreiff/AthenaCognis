"""Activity routes: data sources, their lifecycle and their time-ranged feeds."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from controllers.activity.base import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    DataSource,
    FolderBrowsingError,
    InvalidFolderError,
    InvalidRangeError,
    InvalidSettingError,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.filters import InvalidFilterError
from controllers.activity.registry import (
    IncomingSourceError,
    UnknownSourceError,
    all_sources,
    get_source,
)

HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409
HTTP_BAD_GATEWAY = 502
START_QUERY = Query(..., description="Window start (ISO, naive = UTC)")
END_QUERY = Query(..., description="Window end, excluded")
PATH_QUERY = Query("", description="Folder relative to the source root")
LIMIT_QUERY = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)

router = APIRouter(prefix="/activity", tags=["Activity"])

JsonDict = dict[str, object]


class SourceNotAddedError(Exception):
    """Source must be added to the Activity page first."""


class SourceNotConfiguredError(Exception):
    """Underlying system is not set up (e.g. no mail account)."""


@contextmanager
def http_errors() -> Iterator[None]:
    """
    Map data source errors to HTTP errors

    Returns:
        Iterator[None]: guarded block
    Raises:
        HTTPException: 400 bad range or filter, 404 unknown source, 409 source not usable,
            502 underlying system unreachable
    """
    try:
        yield
    except UnknownSourceError as error:
        raise HTTPException(status_code=HTTP_NOT_FOUND, detail=error.args[0]) from error
    except (
        IncomingSourceError,
        FolderBrowsingError,
        SourceNotAddedError,
        SourceNotConfiguredError,
    ) as error:
        raise HTTPException(status_code=HTTP_CONFLICT, detail=str(error)) from error
    except (
        InvalidRangeError,
        InvalidFilterError,
        InvalidFolderError,
        InvalidSettingError,
    ) as error:
        raise HTTPException(status_code=HTTP_BAD_REQUEST, detail=str(error)) from error
    except SourceUnavailableError as error:
        raise HTTPException(status_code=HTTP_BAD_GATEWAY, detail=str(error)) from error


@router.get("/sources")
def list_sources() -> list[JsonDict]:
    """
    List every data source with its state

    Returns:
        list[JsonDict]: sources
    """
    return [info.view() for info in all_sources()]


@router.post("/sources/{key}")
def add_source(key: str) -> JsonDict:
    """
    Add a set-up source to the Activity page, enabled

    Args:
        key (str): source key
    Returns:
        JsonDict: source
    Raises:
        HTTPException: 404 unknown, 409 incoming or not set up
    """
    with http_errors():
        source = get_source(key)
        if not source.is_configured():
            raise SourceNotConfiguredError(f"Set up '{key}' before adding it.")
        source.add()
    return source.info().view()


class SourceStateBody(BaseModel):
    """Enable or disable an added source."""

    enabled: bool


@router.patch("/sources/{key}")
def set_source_enabled(key: str, body: SourceStateBody) -> JsonDict:
    """
    Enable or disable an added source

    Args:
        key (str): source key
        body (SourceStateBody): new state
    Returns:
        JsonDict: source
    Raises:
        HTTPException: 404 unknown, 409 incoming or not added
    """
    with http_errors():
        source = added_source(key)
        source.set_enabled(body.enabled)
    return source.info().view()


@router.delete("/sources/{key}")
def remove_source(key: str) -> JsonDict:
    """
    Remove a source from the Activity page and reset its settings

    Args:
        key (str): source key
    Returns:
        JsonDict: source
    Raises:
        HTTPException: 404 unknown, 409 incoming
    """
    with http_errors():
        source = get_source(key)
        source.remove()
    return source.info().view()


def added_source(key: str) -> DataSource:
    """
    Find a source already added to the Activity page

    Args:
        key (str): source key
    Returns:
        DataSource: source
    Raises:
        SourceNotAddedError: source is not added
    """
    source = get_source(key)
    if source.state() not in ("active", "disabled"):
        raise SourceNotAddedError(f"Add '{key}' to the Activity page first.")
    return source


@router.get("/sources/{key}/feed")
def source_feed(
    key: str,
    start: datetime = START_QUERY,
    end: datetime = END_QUERY,
    limit: int = LIMIT_QUERY,
) -> list[JsonDict]:
    """
    Return the activities of one source in [start, end), newest first

    Args:
        key (str): source key
        start (datetime): window start (ISO, naive = UTC)
        end (datetime): window end, excluded
        limit (int): maximum number of activities
    Returns:
        list[JsonDict]: activities (empty when the source is off)
    Raises:
        HTTPException: 400 bad range or filter, 404 unknown source, 409 not available yet,
            502 underlying system unreachable
    """
    with http_errors():
        source = get_source(key)
        window = TimeRange(start, end)
        activities = source.activities(window, limit)
    return [activity.view() for activity in activities]


@router.get("/sources/{key}/folders")
def browse_folders(key: str, path: str = PATH_QUERY) -> list[JsonDict]:
    """
    List the subfolders of a folder, for the folder picker of a source

    Args:
        key (str): source key
        path (str): folder relative to the source root ("" for the root)
    Returns:
        list[JsonDict]: subfolders (name, path, has_children)
    Raises:
        HTTPException: 400 folder outside the root or missing, 404 unknown source,
            409 source without folders
    """
    with http_errors():
        entries = get_source(key).browse(path)
    return [entry.view() for entry in entries]


@router.get("/sources/{key}/progress")
def source_progress(key: str) -> JsonDict:
    """
    Progress of the feed being collected (long scans, e.g. local files)

    Args:
        key (str): source key
    Returns:
        JsonDict: running, done, total, files
    Raises:
        HTTPException: 404 unknown source, 409 source not available yet
    """
    with http_errors():
        progress = get_source(key).progress()
    return progress.view()

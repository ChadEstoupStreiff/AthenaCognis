"""Activity generation: queue a day, read what was generated, Jobs page status."""

from dataclasses import asdict
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from controllers.activity.base import to_naive_utc
from controllers.activity.generation import (
    ACTIVITY_PROJECT,
    CLOCK_FORMAT,
    DAILY_PREFIX,
    DAY_FORMAT,
    DailyRequest,
    GenerationRequestError,
    Output,
    daily_key,
    daily_note_path,
)
from controllers.ActivityGenerationManager import ActivityGenerationManager
from controllers.calendar_links import links_of, record_ids_in_project
from controllers.JobManager import JobAlreadyQueuedError
from db import ActivityGenerationTask, CalendarRecord, get_db

HTTP_BAD_REQUEST = 400
HTTP_CONFLICT = 409

router = APIRouter(prefix="/activity-generation", tags=["Activity"])

JsonDict = dict[str, object]


class DailyBody(BaseModel):
    """Daily generation request sent by the Activity page."""

    day: str
    start: datetime
    end: datetime
    utc_offset_minutes: int
    sources: list[str]
    outputs: list[Output]


def task_label(file: str) -> str:
    """
    Readable name of a generation task

    Args:
        file (str): job key ("daily/<day>")
    Returns:
        str: "Daily · <day>", the key itself when unknown
    """
    if file.startswith(DAILY_PREFIX):
        return f"Daily · {file.removeprefix(DAILY_PREFIX)}"
    return file


def parse_day(day: str) -> datetime:
    """
    Read a day of the URL

    Args:
        day (str): "YYYY-MM-DD"
    Returns:
        datetime: local midnight
    Raises:
        HTTPException: 400 malformed day
    """
    try:
        return datetime.strptime(day, DAY_FORMAT)
    except ValueError as error:
        raise HTTPException(HTTP_BAD_REQUEST, f"Bad day '{day}'.") from error


def latest_task(file: str) -> JsonDict | None:
    """
    Latest generation run of a key

    Args:
        file (str): job key
    Returns:
        JsonDict | None: state, added, completed, result; None when never run
    """
    with get_db() as db:
        task = (
            db.query(ActivityGenerationTask)
            .filter(ActivityGenerationTask.file == file)
            .order_by(ActivityGenerationTask.added.desc())
            .first()
        )
        if task is None:
            return None
        return {
            "state": task.state.value,
            "added": task.added.isoformat(),
            "completed": task.completed.isoformat() if task.completed else None,
            "result": task.result,
        }


def generated_records(date: datetime) -> list[JsonDict]:
    """
    Generated time entries of a day, by start time

    Args:
        date (datetime): local midnight
    Returns:
        list[JsonDict]: id, start ("HH:MM" or None), hours, title, description,
            projects (Activity left out), tags
    """
    with get_db() as db:
        records = (
            db.query(CalendarRecord)
            .filter(
                CalendarRecord.id.in_(record_ids_in_project(db, ACTIVITY_PROJECT)),
                CalendarRecord.date == date,
            )
            .order_by(CalendarRecord.start_time)
            .all()
        )
        links = links_of(db, records)
        return [
            {
                "id": record.id,
                "start": record.start_time.strftime(CLOCK_FORMAT)
                if record.start_time
                else None,
                "hours": record.time_spent,
                "title": record.title,
                "description": record.description or "",
                "projects": [
                    name for name in links[record.id].projects if name != ACTIVITY_PROJECT
                ],
                "tags": list(links[record.id].tags),
            }
            for record in records
        ]


@router.post("/daily")
def request_daily(body: DailyBody) -> JsonDict:
    """
    Queue the generation of a day

    Args:
        body (DailyBody): request
    Returns:
        JsonDict: queued job key
    Raises:
        HTTPException: 400 malformed request, 409 day already generating
    """
    try:
        request = DailyRequest(
            day=body.day,
            start=to_naive_utc(body.start),
            end=to_naive_utc(body.end),
            utc_offset_minutes=body.utc_offset_minutes,
            sources=tuple(body.sources),
            outputs=tuple(body.outputs),
        )
        ActivityGenerationManager.request_daily(request)
    except GenerationRequestError as error:
        raise HTTPException(HTTP_BAD_REQUEST, str(error)) from error
    except JobAlreadyQueuedError as error:
        raise HTTPException(HTTP_CONFLICT, str(error)) from error
    return {"key": request.key}


@router.get("/daily/{day}")
def read_daily(day: str) -> JsonDict:
    """
    What was generated for a day: latest run, note and time entries

    Args:
        day (str): "YYYY-MM-DD"
    Returns:
        JsonDict: day, task (or None), note (path and content, or None), records
    Raises:
        HTTPException: 400 malformed day
    """
    date = parse_day(day)
    path = daily_note_path(ActivityGenerationManager.root, day)
    note = (
        {"path": str(path), "content": path.read_text(encoding="utf-8")}
        if path.is_file()
        else None
    )
    return {
        "day": day,
        "task": latest_task(daily_key(day)),
        "note": note,
        "records": generated_records(date),
    }


@router.get("/health")
def health() -> str:
    """
    Activity generation daemon health

    Returns:
        str: RUNNING when the daemon thread is alive, DEAD otherwise
    """
    return "RUNNING" if ActivityGenerationManager.is_alive() else "DEAD"


@router.get("/running")
def running() -> str | None:
    """
    Name of the generation in progress

    Returns:
        str | None: label, None when idle
    """
    file = ActivityGenerationManager.in_progress_file
    return None if file is None else task_label(file)


@router.get("/tasks")
def list_tasks() -> list[JsonDict]:
    """
    Generation runs, each labelled

    Returns:
        list[JsonDict]: tasks (`file` = job key, `label` = readable name)
    """
    return [
        {**asdict(task), "label": task_label(task.file)}
        for task in ActivityGenerationManager.list_tasks()
    ]

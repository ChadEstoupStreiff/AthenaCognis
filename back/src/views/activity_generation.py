"""Activity generation: queue a period, read what was generated, Jobs page status."""

from dataclasses import asdict
from datetime import date, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from controllers.activity.base import to_naive_utc
from controllers.activity.generation import (
    DAY_FORMAT,
    SPAN_TITLES,
    Basis,
    GenerationRequest,
    GenerationRequestError,
    Span,
    job_key,
    note_path,
    period_label,
    split_key,
)
from controllers.activity.generation_prompt import DryRun
from controllers.activity.generation_schedule import SKIPPED_SETTING
from controllers.activity.generation_status import DayStatus, LatestRun, day_statuses
from controllers.activity.off_days import (
    days_between,
    read_rules,
    read_skipped,
    supported_countries,
)
from controllers.ActivityGenerationManager import ActivityGenerationManager
from controllers.JobManager import JobAlreadyQueuedError
from db import ActivityGenerationTask, get_db
from views.settings import get_setting

HTTP_BAD_REQUEST = 400
HTTP_CONFLICT = 409

router = APIRouter(prefix="/activity-generation", tags=["Activity"])

JsonDict = dict[str, object]


class GenerationBody(BaseModel):
    """Generation request sent by the Activity page."""

    span: Span
    day: str
    start: datetime
    end: datetime
    utc_offset_minutes: int
    basis: Basis
    sources: list[str] = Field(default_factory=list)
    instruction: str = ""
    fill_daily: bool = False


def task_label(file: str) -> str:
    """
    Readable name of a generation task

    Args:
        file (str): job key ("<span>/<first day>")
    Returns:
        str: "Daily · <day>", "Weekly · Week of <day>", "Monthly · YYYY-MM"; the key when unknown
    """
    parsed = split_key(file)
    if parsed is None:
        return file
    span, day = parsed
    try:
        return f"{SPAN_TITLES[span]} · {period_label(span, day)}"
    except GenerationRequestError:
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


def generation_request(body: GenerationBody) -> GenerationRequest:
    """
    Validate a generation request body

    Args:
        body (GenerationBody): request
    Returns:
        GenerationRequest: request, window in naive UTC
    Raises:
        HTTPException: 400 malformed request
    """
    try:
        return GenerationRequest(
            span=body.span,
            day=body.day,
            start=to_naive_utc(body.start),
            end=to_naive_utc(body.end),
            utc_offset_minutes=body.utc_offset_minutes,
            basis=body.basis,
            sources=tuple(body.sources),
            instruction=body.instruction,
            fill_daily=body.fill_daily,
        )
    except GenerationRequestError as error:
        raise HTTPException(HTTP_BAD_REQUEST, str(error)) from error


@router.post("/dry-run")
def dry_run(body: GenerationBody) -> DryRun:
    """
    Prompt a generation would send, with its size; nothing asked nor written

    Args:
        body (GenerationBody): request
    Returns:
        DryRun: prompt, size overall and per block, routed model
    Raises:
        HTTPException: 400 malformed request
    """
    return ActivityGenerationManager.dry_run(generation_request(body))


@router.post("/generate")
def request_generation(body: GenerationBody) -> JsonDict:
    """
    Queue the generation of a period

    Args:
        body (GenerationBody): request
    Returns:
        JsonDict: queued job key
    Raises:
        HTTPException: 400 malformed request, 409 period already generating
    """
    request = generation_request(body)
    try:
        ActivityGenerationManager.request(request)
    except JobAlreadyQueuedError as error:
        raise HTTPException(HTTP_CONFLICT, str(error)) from error
    return {"key": request.key}


def latest_runs(days: list[date]) -> dict[str, LatestRun]:
    """
    Latest generation run of each day

    Args:
        days (list[date]): local days
    Returns:
        dict[str, LatestRun]: run per "YYYY-MM-DD", days never run left out
    """
    keys = {job_key("daily", day.strftime(DAY_FORMAT)): day.strftime(DAY_FORMAT) for day in days}
    with get_db() as db:
        tasks = (
            db.query(ActivityGenerationTask)
            .filter(ActivityGenerationTask.file.in_(keys))
            .order_by(ActivityGenerationTask.added)
            .all()
        )
        # Ordered by date: later runs replace earlier ones.
        return {keys[task.file]: LatestRun(task.state, task.result) for task in tasks}


@router.get("/daily-status")
def daily_status(first: str, last: str) -> list[DayStatus]:
    """
    Status of each day of a span: generated, failed, running or skipped, and off reason

    Args:
        first (str): first day, "YYYY-MM-DD"
        last (str): last day, "YYYY-MM-DD"
    Returns:
        list[DayStatus]: one status per day
    Raises:
        HTTPException: 400 malformed days or span too long
    """
    try:
        days = days_between(parse_day(first).date(), parse_day(last).date())
    except ValueError as error:
        raise HTTPException(HTTP_BAD_REQUEST, str(error)) from error
    skipped = read_skipped(get_setting(SKIPPED_SETTING))
    return day_statuses(days, latest_runs(days), skipped, read_rules(get_setting))


@router.get("/holiday-countries")
def holiday_countries() -> dict[str, list[str]]:
    """
    Countries with known public holidays

    Returns:
        dict[str, list[str]]: subdivision codes per two-letter country code
    """
    return supported_countries()


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


@router.get("/{span}/{day}")
def read_generation(span: Span, day: str) -> JsonDict:
    """
    What was generated for a period: latest run and note

    Args:
        span (Span): time span
        day (str): first day, "YYYY-MM-DD"
    Returns:
        JsonDict: span, day, task (or None), note (path and content, or None)
    Raises:
        HTTPException: 400 malformed day
    """
    parse_day(day)
    path = note_path(ActivityGenerationManager.root, span, day)
    note = (
        {"path": str(path), "content": path.read_text(encoding="utf-8")}
        if path.is_file()
        else None
    )
    return {"span": span, "day": day, "task": latest_task(job_key(span, day)), "note": note}

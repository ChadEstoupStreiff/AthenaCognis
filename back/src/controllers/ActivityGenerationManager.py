"""Activity generation daemon: daily summary note and time entries from data sources."""

import logging
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from controllers.activity.base import (
    MAX_LIMIT,
    InvalidRangeError,
    InvalidSettingError,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.common import LIBRARY_ROOT
from controllers.activity.filters import InvalidFilterError
from controllers.activity.generation import (
    ACTIVITY_PROJECT,
    ACTIVITY_PROJECT_COLOR,
    ACTIVITY_PROJECT_DESCRIPTION,
    SUMMARY_PROMPT,
    TIME_PROMPT,
    Catalog,
    DailyRequest,
    GenerationRequestError,
    SourceSection,
    TimeEntry,
    build_context,
    daily_key,
    daily_note,
    daily_note_path,
    has_activity,
    parse_time_entries,
)
from controllers.activity.generation_schedule import GenerationScheduler, SchedulerHooks
from controllers.activity.registry import (
    IMPLEMENTED,
    IncomingSourceError,
    UnknownSourceError,
    get_source,
)
from controllers.activity.settings_io import write_setting
from controllers.calendar_links import record_ids_in_project, set_record_links
from controllers.JobManager import JobManager
from db import (
    ActivityGenerationTask,
    CalendarRecord,
    JobTask,
    Project,
    ProjectFile,
    Tag,
    TaskStateEnum,
    get_db,
)
from tools.ai import request_llm
from views.settings import get_setting

SETTING_PREFIX = "activity"
FALLBACK_SETTING_PREFIX = "summarization"
# Clock-only datetimes of time entries use this date (see views/calendar.py).
CLOCK_DATE = datetime(1900, 1, 1)
SOURCE_ERRORS = (
    SourceUnavailableError,
    InvalidSettingError,
    InvalidFilterError,
    InvalidRangeError,
    UnknownSourceError,
    IncomingSourceError,
)

logger = logging.getLogger(__name__)

LlmCall = Callable[[str], str]


def routing_prefix() -> str:
    """
    Settings prefix of generation requests (Summaries routing until Activity is set)

    Returns:
        str: "activity" when activity_type is set, "summarization" otherwise
    """
    return SETTING_PREFIX if get_setting(f"{SETTING_PREFIX}_type") else FALLBACK_SETTING_PREFIX


def ask_activity_llm(prompt: str) -> str:
    """
    Send a prompt to the model routed for activity generation

    Args:
        prompt (str): prompt
    Returns:
        str: answer
    """
    _, _, answer = request_llm(setting_prefix=routing_prefix(), prompt=prompt)
    return str(answer)


def ensure_activity_project(db: Session) -> None:
    """
    Create the non-editable Activity project when missing (not committed)

    Args:
        db (Session): session
    Returns:
        None
    """
    if db.get(Project, ACTIVITY_PROJECT) is None:
        db.add(
            Project(
                name=ACTIVITY_PROJECT,
                description=ACTIVITY_PROJECT_DESCRIPTION,
                color=ACTIVITY_PROJECT_COLOR,
            )
        )
        db.flush()


def read_section(key: str, window: TimeRange) -> SourceSection:
    """
    Read the activities of one data source, keeping its error instead of failing

    Args:
        key (str): source key
        window (TimeRange): time window
    Returns:
        SourceSection: activities, or the reason they could not be read
    """
    try:
        source = get_source(key)
    except (UnknownSourceError, IncomingSourceError) as error:
        return SourceSection(key, "", (), str(error))
    label = source.descriptor.label
    try:
        activities = source.activities(window, MAX_LIMIT)
    except SOURCE_ERRORS as error:
        logger.warning("Activity generation: %s unreadable: %s", key, error)
        return SourceSection(label, source.instruction(), (), str(error))
    return SourceSection(label, source.instruction(), tuple(activities))


def load_catalog(db: Session) -> Catalog:
    """
    Projects (but Activity) and tags the LLM may give to time entries

    Args:
        db (Session): session
    Returns:
        Catalog: names (and project descriptions), sorted
    """
    projects = db.query(Project.name, Project.description).order_by(Project.name)
    return Catalog(
        tuple(
            (str(name), str(description or ""))
            for name, description in projects
            if name != ACTIVITY_PROJECT
        ),
        tuple(str(name) for (name,) in db.query(Tag.name).order_by(Tag.name)),
    )


def replace_time_entries(db: Session, day: str, entries: list[TimeEntry]) -> None:
    """
    Replace the generated time entries of a day (those linked to the Activity project)

    Args:
        db (Session): session
        day (str): "YYYY-MM-DD"
        entries (list[TimeEntry]): new entries, with their projects and tags
    Returns:
        None
    """
    date = datetime.strptime(day, "%Y-%m-%d")
    generated = record_ids_in_project(db, ACTIVITY_PROJECT)
    for record in db.query(CalendarRecord).filter(
        CalendarRecord.id.in_(generated), CalendarRecord.date == date
    ):
        db.delete(record)
    db.flush()
    for entry in entries:
        record = CalendarRecord(
            date=date,
            start_time=datetime.combine(CLOCK_DATE, entry.start),
            time_spent=entry.hours,
            title=entry.title,
            description=entry.description,
        )
        db.add(record)
        db.flush()
        set_record_links(db, record, [ACTIVITY_PROJECT, *entry.projects], entry.tags)


def link_to_project(db: Session, path: Path) -> None:
    """
    Add a file to the Activity project when not already in it

    Args:
        db (Session): session
        path (Path): file path
    Returns:
        None
    """
    file = str(path)
    if db.get(ProjectFile, (ACTIVITY_PROJECT, file)) is None:
        db.add(ProjectFile(project=ACTIVITY_PROJECT, file=file))


class ActivityGenerationManager(JobManager):
    """Generate activity summaries and time entries (`file` = "daily/<date>")."""

    name = "ACTIVITY"
    task_model = ActivityGenerationTask
    llm: LlmCall = staticmethod(ask_activity_llm)
    root: Path = LIBRARY_ROOT

    @classmethod
    def new_task(cls, file: str, payload: str | None) -> JobTask:
        """
        Create a pending generation task keeping its request

        Args:
            file (str): job key
            payload (str | None): request JSON
        Returns:
            JobTask: pending task
        """
        return ActivityGenerationTask(
            file=file, added=datetime.now(), state=TaskStateEnum.PENDING, params=payload
        )

    @classmethod
    def request_daily(cls, request: DailyRequest) -> None:
        """
        Queue a daily generation

        Args:
            request (DailyRequest): request
        Returns:
            None
        Raises:
            JobAlreadyQueuedError: when the day already has an open task
        """
        cls.add_file_to_queue(request.key, request.to_json())

    @classmethod
    def running_request(cls, db: Session, file: str) -> DailyRequest:
        """
        Read the request of the running task of a key

        Args:
            db (Session): session
            file (str): job key
        Returns:
            DailyRequest: request
        Raises:
            GenerationRequestError: no running task or malformed request
        """
        task = (
            db.query(ActivityGenerationTask)
            .filter(
                ActivityGenerationTask.file == file,
                ActivityGenerationTask.state == TaskStateEnum.IN_PROGRESS,
            )
            .order_by(ActivityGenerationTask.added.desc())
            .first()
        )
        if task is None or not task.params:
            raise GenerationRequestError(f"No running request for {file}.")
        return DailyRequest.from_json(task.params)

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Generate the requested outputs of a day

        Args:
            file (str): job key
            db (Session): session committed with the task completion
        Returns:
            str: what was generated
        Raises:
            GenerationRequestError: bad request, or no activity in the picked sources
            ValueError: time entries answer unreadable
        """
        request = cls.running_request(db, file)
        window = TimeRange(request.start, request.end)
        sections = [read_section(key, window) for key in request.sources]
        if not has_activity(sections):
            raise GenerationRequestError("No activity in the picked data sources.")
        context = build_context(sections, request.utc_offset_minutes)
        # Ask everything first: a failed answer must leave nothing half written.
        summary = (
            cls.ask(SUMMARY_PROMPT, request.day, context)
            if "summary" in request.outputs
            else None
        )
        entries = (
            cls.ask_time_entries(db, request.day, context)
            if "time" in request.outputs
            else None
        )
        ensure_activity_project(db)
        done: list[str] = []
        if summary is not None:
            cls.write_note(db, request.day, summary)
            done.append("summary note")
        if entries is not None:
            replace_time_entries(db, request.day, entries)
            done.append(f"{len(entries)} time entries")
        return f"Generated {' and '.join(done)}."

    @classmethod
    def ask(cls, prompt: str, day: str, context: str) -> str:
        """
        Ask the LLM a generation prompt filled with the day and its context

        Args:
            prompt (str): prompt with {day} and {input}
            day (str): "YYYY-MM-DD"
            context (str): activity context
        Returns:
            str: answer
        """
        return cls.llm(prompt.replace("{day}", day).replace("{input}", context))

    @classmethod
    def ask_time_entries(cls, db: Session, day: str, context: str) -> list[TimeEntry]:
        """
        Ask the time entries of a day, with projects and tags picked from the catalog

        Args:
            db (Session): session
            day (str): "YYYY-MM-DD"
            context (str): activity context
        Returns:
            list[TimeEntry]: entries
        Raises:
            ValueError: answer unreadable
        """
        catalog = load_catalog(db)
        prompt = TIME_PROMPT.replace("{catalog}", catalog.text())
        return parse_time_entries(cls.ask(prompt, day, context), catalog)

    @classmethod
    def write_note(cls, db: Session, day: str, summary: str) -> None:
        """
        Write the summary as the day's note and add it to the Activity project

        Args:
            db (Session): session
            day (str): "YYYY-MM-DD"
            summary (str): LLM summary
        Returns:
            None
        """
        path = daily_note_path(cls.root, day)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(daily_note(day, summary), encoding="utf-8")
        link_to_project(db, path)


def setup_activity_project() -> None:
    """
    Create the Activity project at startup when missing

    Returns:
        None
    """
    with get_db() as db:
        ensure_activity_project(db)
        db.commit()


def active_source_keys() -> tuple[str, ...]:
    """
    Keys of the enabled data sources

    Returns:
        tuple[str, ...]: keys
    """
    return tuple(source.key for source in IMPLEMENTED if source.state() == "active")


def has_generated(day: str) -> bool:
    """
    Tell whether a day was generated or is generating (failed runs do not count)

    Args:
        day (str): "YYYY-MM-DD"
    Returns:
        bool: True when a run is pending, running or completed
    """
    state = ActivityGenerationManager.latest_state(daily_key(day))
    return state is not None and state != TaskStateEnum.FAILED


def start_scheduler() -> None:
    """
    Start the scheduled activity generation

    Returns:
        None
    """
    GenerationScheduler.start(
        SchedulerHooks(
            read=get_setting,
            write=write_setting,
            active_sources=active_source_keys,
            has_run=has_generated,
            queue=ActivityGenerationManager.request_daily,
        )
    )

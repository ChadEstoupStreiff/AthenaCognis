"""Activity generation daemon: daily, weekly and monthly summary notes."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from controllers.activity.agenda_source import AGENDA_DESCRIPTOR, AgendaDataSource
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
    GenerationRequest,
    GenerationRequestError,
    SourceSection,
    SummarySection,
    has_activity,
    note_markdown,
    note_path,
    strip_fence,
)
from controllers.activity.generation_context import generated_sections
from controllers.activity.generation_prompt import (
    DryRun,
    Prompt,
    PromptStats,
    build_prompt,
    part_stats,
)
from controllers.activity.generation_schedule import GenerationScheduler, SchedulerHooks
from controllers.activity.registry import (
    IMPLEMENTED,
    IncomingSourceError,
    UnknownSourceError,
    get_source,
)
from controllers.activity.settings_io import write_setting
from controllers.JobManager import JobManager
from db import (
    ActivityGenerationTask,
    JobTask,
    Project,
    ProjectFile,
    TaskStateEnum,
    get_db,
)
from tools.ai import get_model_context_tokens, request_llm
from views.settings import get_setting

SETTING_PREFIX = "activity"
FALLBACK_SETTING_PREFIX = "summarization"
NO_ACTIVITY = "No activity in the picked data sources."
NO_SUMMARY = "No generated summary in this period."
SOURCE_ERRORS = (
    SourceUnavailableError,
    InvalidSettingError,
    InvalidFilterError,
    InvalidRangeError,
    UnknownSourceError,
    IncomingSourceError,
)

# Source states of an added source (a disabled agenda still tells off days).
ADDED_STATES = ("active", "disabled")

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


@dataclass(frozen=True)
class PreparedPrompt:
    """Prompt of a request and whether its context holds anything."""

    prompt: Prompt
    # Why nothing can be summarized, "" when the context holds something.
    empty_reason: str


def read_context(
    request: GenerationRequest, root: Path
) -> tuple[list[SourceSection], list[SummarySection]]:
    """
    Read the context of a request: data sources or generated summaries

    Args:
        request (GenerationRequest): request
        root (Path): shared root holding generated notes
    Returns:
        tuple[list[SourceSection], list[SummarySection]]: source activities, summaries
    """
    if request.basis != "sources":
        return [], generated_sections(root, request)
    window = TimeRange(request.start, request.end)
    return [read_section(key, window) for key in request.sources], []


def prepare_prompt(request: GenerationRequest, root: Path) -> PreparedPrompt:
    """
    Read the context of a request and build its single prompt

    Args:
        request (GenerationRequest): request
        root (Path): shared root holding generated notes
    Returns:
        PreparedPrompt: prompt, and why it is empty ("" when not)
    """
    sources, summaries = read_context(request, root)
    if request.basis == "sources":
        reason = "" if has_activity(sources) else NO_ACTIVITY
    else:
        reason = "" if summaries else NO_SUMMARY
    return PreparedPrompt(build_prompt(request, sources, summaries), reason)


def routed_model() -> tuple[str, int]:
    """
    Model routed for activity generation and its context window

    Returns:
        tuple[str, int]: "type · model" ("" when unset), context window in tokens
    """
    prefix = routing_prefix()
    ai_type = str(get_setting(f"{prefix}_type") or "")
    model = str(get_setting(f"{prefix}_model") or "")
    label = " · ".join(part for part in (ai_type, model) if part)
    return label, get_model_context_tokens(ai_type, model)


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
    """Generate activity summaries (`file` = "<span>/<first day>")."""

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
    def request(cls, request: GenerationRequest) -> None:
        """
        Queue a generation

        Args:
            request (GenerationRequest): request
        Returns:
            None
        Raises:
            JobAlreadyQueuedError: when the period already has an open task
        """
        cls.add_file_to_queue(request.key, request.to_json())

    @classmethod
    def running_request(cls, db: Session, file: str) -> GenerationRequest:
        """
        Read the request of the running task of a key

        Args:
            db (Session): session
            file (str): job key
        Returns:
            GenerationRequest: request
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
        return GenerationRequest.from_json(task.params)

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Generate the summary note of a period

        Args:
            file (str): job key
            db (Session): session committed with the task completion
        Returns:
            str: what was generated
        Raises:
            GenerationRequestError: bad request, or nothing to summarize
            ValueError: empty answer
        """
        request = cls.running_request(db, file)
        prepared = prepare_prompt(request, cls.root)
        if prepared.empty_reason:
            raise GenerationRequestError(prepared.empty_reason)
        summary = strip_fence(cls.llm(prepared.prompt.text()))
        if not summary:
            raise ValueError("The model answered an empty summary.")
        ensure_activity_project(db)
        cls.write_note(db, request, summary)
        return "Generated summary note."

    @classmethod
    def dry_run(cls, request: GenerationRequest) -> DryRun:
        """
        Build the prompt of a request without asking the LLM or writing anything

        Args:
            request (GenerationRequest): request
        Returns:
            DryRun: prompt, its size overall and per block, routed model
        """
        prompt = prepare_prompt(request, cls.root).prompt
        text = prompt.text()
        model, context_tokens = routed_model()
        return DryRun(
            prompt=text,
            stats=PromptStats.of(text),
            parts=part_stats(prompt),
            model=model,
            context_tokens=context_tokens,
        )

    @classmethod
    def write_note(cls, db: Session, request: GenerationRequest, summary: str) -> None:
        """
        Write the summary as the period's note and add it to the Activity project

        Args:
            db (Session): session
            request (GenerationRequest): request
            summary (str): LLM summary
        Returns:
            None
        """
        path = note_path(cls.root, request.span, request.day)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(note_markdown(request.span, request.day, summary), encoding="utf-8")
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


def has_generated(key: str) -> bool:
    """
    Tell whether a period was generated or is generating (failed runs do not count)

    Args:
        key (str): job key, "<span>/<first day>"
    Returns:
        bool: True when a run is pending, running or completed
    """
    state = ActivityGenerationManager.latest_state(key)
    return state is not None and state != TaskStateEnum.FAILED


def agenda_titles(day: date) -> tuple[str, ...]:
    """
    Titles of the all-day agenda events of a day, for off day detection

    Args:
        day (date): local day
    Returns:
        tuple[str, ...]: titles, empty when the agenda is not added or unreadable
    """
    source = get_source(AGENDA_DESCRIPTOR.key)
    if not isinstance(source, AgendaDataSource) or source.state() not in ADDED_STATES:
        return ()
    try:
        return source.all_day_titles(day)
    except SourceUnavailableError as error:
        logger.warning("Agenda unreadable for off day detection of %s: %s", day, error)
        return ()


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
            queue=ActivityGenerationManager.request,
            agenda_titles=agenda_titles,
        )
    )

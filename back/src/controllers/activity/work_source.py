"""Work board data source: tasks completed, due or started."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from controllers.activity.base import Activity, DataSource, SourceDescriptor, TimeRange
from controllers.activity.common import (
    column_values,
    excerpt,
    session_scope,
    tag_names,
    typed_column,
)
from controllers.activity.config import ConfigField, SourceConfig, options_of
from db import (
    KanbanBoard,
    KanbanColumn,
    KanbanColumnTask,
    Project,
    Task,
    TaskProject,
    TaskTag,
)

WORK_DESCRIPTOR = SourceDescriptor(
    "work",
    "Work board",
    "pi pi-th-large",
    "Tasks completed, due or started.",
    "athenacognis",
)
# Event kind → Task column holding its moment.
EVENT_COLUMNS = {
    "completed": typed_column(Task.completed, datetime),
    "due": typed_column(Task.end_date, datetime),
    "started": typed_column(Task.start_date, datetime),
}
EVENT_OPTIONS = options_of(
    [("completed", "Completed"), ("due", "Due"), ("started", "Started")]
)
DEFAULT_EVENTS = ("completed", "due")
EVENT_TITLES = {"completed": "Completed", "due": "Due", "started": "Started"}


@dataclass(frozen=True)
class TaskRow:
    """Fields of a task used by the feed."""

    id: str
    title: str
    description: str
    priority: float
    moments: dict[str, datetime | None]


def task_rows(
    session: Session, window: TimeRange, events: Sequence[str]
) -> list[TaskRow]:
    """
    Load tasks with at least one picked event inside the window

    Args:
        session (Session): session
        window (TimeRange): time window
        events (Sequence[str]): EVENT_COLUMNS keys
    Returns:
        list[TaskRow]: tasks
    """
    inside: list[ColumnElement[bool]] = [
        and_(EVENT_COLUMNS[kind] >= window.start, EVENT_COLUMNS[kind] < window.end)
        for kind in events
    ]
    statement = select(
        typed_column(Task.id, str),
        typed_column(Task.title, str),
        typed_column(Task.description, str),
        typed_column(Task.priority, float),
        *EVENT_COLUMNS.values(),
    ).where(or_(*inside))
    rows: list[TaskRow] = []
    for task_id, title, description, priority, *moments in session.execute(statement):
        rows.append(
            TaskRow(
                str(task_id),
                str(title),
                str(description or ""),
                float(priority or 0),
                dict(zip(EVENT_COLUMNS, moments, strict=True)),
            )
        )
    return rows


@dataclass
class TaskContext:
    """Board placement, projects and tags of one task."""

    boards: set[str] = field(default_factory=set)
    columns: set[str] = field(default_factory=set)
    projects: set[str] = field(default_factory=set)
    tags: set[str] = field(default_factory=set)


def contexts_of(session: Session, task_ids: Sequence[str]) -> dict[str, TaskContext]:
    """
    Load board columns, projects and tags of tasks

    Args:
        session (Session): session
        task_ids (Sequence[str]): task ids
    Returns:
        dict[str, TaskContext]: context per task id
    """
    contexts = {task_id: TaskContext() for task_id in task_ids}
    placements = session.execute(
        select(KanbanColumnTask.task_id, KanbanColumn.name, KanbanColumn.board_id)
        .join(KanbanColumn, KanbanColumn.id == KanbanColumnTask.column_id)
        .where(KanbanColumnTask.task_id.in_(task_ids))
    )
    for task_id, column, board in placements:
        contexts[task_id].columns.add(column)
        contexts[task_id].boards.add(board)
    for task_id, project in session.execute(
        select(TaskProject.task_id, TaskProject.project_name).where(
            TaskProject.task_id.in_(task_ids)
        )
    ):
        contexts[task_id].projects.add(project)
    for task_id, tag in session.execute(
        select(TaskTag.task_id, TaskTag.tag).where(TaskTag.task_id.in_(task_ids))
    ):
        contexts[task_id].tags.add(tag)
    return contexts


def matches(context: TaskContext, config: SourceConfig) -> bool:
    """
    Apply the board, project and tag filters (empty filter = any)

    Args:
        context (TaskContext): task context
        config (SourceConfig): work settings
    Returns:
        bool: True when the task passes every filter
    """
    filters = (
        ("boards", context.boards),
        ("projects", context.projects),
        ("tags", context.tags),
    )
    for name, values in filters:
        picked = set(config.choices(name))
        if picked and not picked & values:
            return False
    return True


def task_activity(
    task: TaskRow, kind: str, moment: datetime, context: TaskContext
) -> Activity:
    """
    Build the activity of one task event

    Args:
        task (TaskRow): task
        kind (str): event kind
        moment (datetime): when it happened
        context (TaskContext): board, projects, tags
    Returns:
        Activity: normalized activity
    """
    details = {"event": EVENT_TITLES[kind], "priority": f"{task.priority:g}"}
    for name, values in (
        ("column", context.columns),
        ("projects", context.projects),
        ("tags", context.tags),
    ):
        if values:
            details[name] = ", ".join(sorted(values))
    if kind == "due":
        details["done"] = "yes" if task.moments["completed"] is not None else "no"
    return Activity(
        id=f"work:{kind}:{task.id}",
        source=WORK_DESCRIPTOR.key,
        kind=kind,
        occurred_at=moment,
        title=task.title,
        summary=excerpt(task.description),
        link="/work",
        details=details,
    )


class WorkDataSource(DataSource):
    """Tasks of the work board, filtered by event, board, project and tag."""

    descriptor = WORK_DESCRIPTOR

    def is_configured(self) -> bool:
        """
        Work board is built in

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Count the open tasks

        Returns:
            str: e.g. "8 open tasks"
        """
        with session_scope() as session:
            count = len(
                session.execute(select(Task.id).where(Task.completed.is_(None))).all()
            )
        return f"{count} open task{'s' if count != 1 else ''}"

    def config_fields(self) -> list[ConfigField]:
        """
        Declare events, boards, projects and tags

        Returns:
            list[ConfigField]: fields
        """
        with session_scope() as session:
            boards = [
                (str(board_id), str(name))
                for board_id, name in session.execute(
                    select(
                        typed_column(KanbanBoard.id, str),
                        typed_column(KanbanBoard.name, str),
                    ).order_by(KanbanBoard.name)
                )
            ]
            projects = [(name, name) for name in column_values(session, Project.name)]
            tags = [(name, name) for name in tag_names(session)]
        return [
            ConfigField(
                "events",
                "Events",
                "Which task events join the feed.",
                "multiselect",
                DEFAULT_EVENTS,
                EVENT_OPTIONS,
                "No event",
            ),
            ConfigField(
                "boards",
                "Only from board",
                "None picked: every board, and tasks on none.",
                "multiselect",
                (),
                options_of(boards),
                "All boards",
            ),
            ConfigField(
                "projects",
                "Only from project",
                "None picked: every project.",
                "multiselect",
                (),
                options_of(projects),
                "All projects",
            ),
            ConfigField(
                "tags",
                "Only tasks tagged",
                "None picked: tagged or not.",
                "multiselect",
                (),
                options_of(tags),
                "Any tag",
            ),
        ]

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the task events of the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per task event
        """
        config = self.config()
        events = config.choices("events")
        if not events:
            return []
        with session_scope() as session:
            tasks = task_rows(session, window, events)
            contexts = contexts_of(session, [task.id for task in tasks])
        activities: list[Activity] = []
        for task in tasks:
            if not matches(contexts[task.id], config):
                continue
            for kind in events:
                moment = task.moments[kind]
                if moment is not None and window.contains(moment):
                    activities.append(
                        task_activity(task, kind, moment, contexts[task.id])
                    )
        return activities

"""Time data source: time records and events logged in Time."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from controllers.activity.base import (
    PEOPLE_CONTENT,
    SUMMARY_CONTENT,
    Activity,
    ContentField,
    DataSource,
    SourceDescriptor,
    TimeRange,
)
from controllers.activity.common import (
    column_values,
    excerpt,
    session_scope,
    typed_column,
)
from controllers.activity.config import ConfigField, SourceConfig, options_of
from controllers.activity.generation import ACTIVITY_PROJECT
from controllers.calendar_links import links_by_id
from db import CalendarRecord, Project

TIME_DESCRIPTOR = SourceDescriptor(
    "time",
    "Time",
    "pi pi-clock",
    "Time records and events logged in Time.",
    "athenacognis",
)
NO_PROJECT = "__none__"
SHORT_RECORD_HOURS = 0.25
MAX_RECORDS = 1000

TIME_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Description"),
    ContentField(PEOPLE_CONTENT, "Attendees"),
    ContentField("duration", "Duration"),
    ContentField("project", "Projects"),
    ContentField("tags", "Tags"),
    ContentField("location", "Location"),
]


@dataclass(frozen=True)
class RecordRow:
    """Fields of a time record used by the feed."""

    id: str
    title: str
    description: str
    occurred_at: datetime
    hours: float
    location: str
    attendees: str
    projects: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()


def record_rows(
    session: Session, window: TimeRange, skip_short: bool
) -> list[RecordRow]:
    """
    Load the time records starting inside the window

    Args:
        session (Session): session
        window (TimeRange): time window
        skip_short (bool): leave out records under SHORT_RECORD_HOURS
    Returns:
        list[RecordRow]: records, newest first
    """
    moment = func.coalesce(
        typed_column(CalendarRecord.start_time, datetime),
        typed_column(CalendarRecord.date, datetime),
    )
    condition = and_(moment >= window.start, moment < window.end)
    if skip_short:
        hours = typed_column(CalendarRecord.time_spent, float)
        condition = and_(condition, hours >= SHORT_RECORD_HOURS)
    statement = (
        select(
            typed_column(CalendarRecord.id, str),
            typed_column(CalendarRecord.title, str),
            typed_column(CalendarRecord.description, str),
            moment,
            typed_column(CalendarRecord.time_spent, float),
            typed_column(CalendarRecord.project, str),
            typed_column(CalendarRecord.location, str),
            typed_column(CalendarRecord.attendees, str),
        )
        .where(condition)
        .order_by(moment.desc())
        .limit(MAX_RECORDS)
    )
    rows = session.execute(statement).all()
    links = links_by_id(session, {str(row[0]): row[5] for row in rows})
    return [
        RecordRow(
            str(row[0]),
            str(row[1]),
            str(row[2] or ""),
            row[3],
            float(row[4] or 0),
            str(row[6] or ""),
            str(row[7] or ""),
            links[str(row[0])].projects,
            links[str(row[0])].tags,
        )
        for row in rows
    ]


def record_activity(record: RecordRow, config: SourceConfig) -> Activity:
    """
    Build the activity of one time record

    Args:
        record (RecordRow): record
        config (SourceConfig): time settings
    Returns:
        Activity: normalized activity
    """
    details = {"duration": f"{record.hours:g} h"}
    if record.projects:
        details["project"] = ", ".join(record.projects)
    if record.tags:
        details["tags"] = ", ".join(record.tags)
    share = config.flag("share_people")
    if share and record.location:
        details["location"] = record.location
    attendees = [name.strip() for name in record.attendees.split(",") if name.strip()]
    return Activity(
        id=f"time:{record.id}",
        source=TIME_DESCRIPTOR.key,
        kind="record",
        occurred_at=record.occurred_at,
        title=record.title,
        summary=excerpt(record.description),
        actors=tuple(attendees) if share else (),
        link="/time",
        details=details,
    )


class TimeDataSource(DataSource):
    """Time records, filtered by project and duration."""

    descriptor = TIME_DESCRIPTOR

    def is_configured(self) -> bool:
        """
        Time is built in

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Describe the project filter

        Returns:
            str: "All projects" or "N projects"
        """
        count = len(self.config().choices("projects"))
        return (
            "All projects"
            if count == 0
            else f"{count} project{'s' if count != 1 else ''}"
        )

    def content_fields(self) -> list[ContentField]:
        """
        Content a time entry activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return TIME_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare projects, short-record and people settings

        Returns:
            list[ConfigField]: fields
        """
        with session_scope() as session:
            names = column_values(session, Project.name)
        kept = [name for name in names if name != ACTIVITY_PROJECT]
        projects = [(NO_PROJECT, "No project"), *[(name, name) for name in kept]]
        return [
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
                "skip_short",
                "Skip records under 15 minutes",
                "Leave quick entries out of the summary.",
                "toggle",
                False,
            ),
            ConfigField(
                "share_people",
                "Share attendees and location with AI",
                "Off: only titles, durations and projects.",
                "toggle",
                True,
            ),
        ]

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the time records of the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per record
        """
        config = self.config()
        projects = set(config.choices("projects"))
        with session_scope() as session:
            records = record_rows(session, window, config.flag("skip_short"))
        return [
            record_activity(record, config)
            for record in records
            # Generated entries summarize the other sources: never fed back.
            if ACTIVITY_PROJECT not in record.projects
            and (not projects or projects & set(record.projects or (NO_PROJECT,)))
        ]

"""Research data source: papers added to the research library and their summaries."""

import json
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

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
    LIBRARY_ROOT,
    SharedFile,
    days_of,
    excerpt,
    parse_shared,
    processed_files,
    research_files,
    session_scope,
    typed_column,
    uploaded_files,
)
from controllers.activity.config import ConfigField, options_of
from db import StockPile

logger = logging.getLogger(__name__)

RESEARCH_DESCRIPTOR = SourceDescriptor(
    "research",
    "Research",
    "pi pi-book",
    "Papers added to the research library and summarized.",
    "athenacognis",
)
INFO_PREFIX = "sota_info_"
MAX_AUTHORS = 3
EVENT_OPTIONS = options_of([("added", "Paper added"), ("summary", "Paper summarized")])
DEFAULT_EVENTS = ("added", "summary")
JsonDict = dict[str, object]

RESEARCH_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Paper summary"),
    ContentField(PEOPLE_CONTENT, "Authors"),
    ContentField("year", "Year"),
    ContentField("journal", "Journal"),
    ContentField("doi", "DOI", default=False),
    ContentField("validated", "Validated", default=False),
]


def paper_info(raw: str | None) -> JsonDict:
    """
    Parse stored paper metadata

    Args:
        raw (str | None): JSON text from the stockpile
    Returns:
        JsonDict: metadata, empty when missing or invalid
    """
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Unreadable paper metadata skipped")
        return {}
    return value if isinstance(value, dict) else {}


def infos_of(files: list[SharedFile]) -> dict[str, JsonDict]:
    """
    Load the metadata of papers

    Args:
        files (list[SharedFile]): papers
    Returns:
        dict[str, JsonDict]: metadata per path
    """
    keys = {f"{INFO_PREFIX}{file.day}_{file.name}": file.path for file in files}
    if not keys:
        return {}
    with session_scope() as session:
        rows: list[tuple[str, str]] = [
            (str(key), str(value))
            for key, value in session.execute(
                select(
                    typed_column(StockPile.key, str), typed_column(StockPile.value, str)
                ).where(typed_column(StockPile.key, str).in_(keys))
            )
        ]
        return {keys[key]: paper_info(value) for key, value in rows}


def text_of(info: JsonDict, field: str) -> str:
    """
    Text field of metadata

    Args:
        info (JsonDict): metadata
        field (str): field name
    Returns:
        str: stripped text, empty when missing
    """
    value = info.get(field)
    return str(value).strip() if value is not None else ""


def paper_activity(
    file: SharedFile, kind: str, moment: datetime, info: JsonDict, summary: str
) -> Activity:
    """
    Build the activity of one paper event

    Args:
        file (SharedFile): paper file
        kind (str): "added" or "summary"
        moment (datetime): when it happened
        info (JsonDict): metadata
        summary (str): summary text, empty for an addition
    Returns:
        Activity: normalized activity
    """
    authors = [
        name.strip() for name in text_of(info, "authors").split(",") if name.strip()
    ]
    details = {
        field: text_of(info, field)
        for field in ("year", "journal", "doi")
        if text_of(info, field)
    }
    details["validated"] = "yes" if info.get("validated") is True else "no"
    return Activity(
        id=f"research:{kind}:{file.path}",
        source=RESEARCH_DESCRIPTOR.key,
        kind=kind,
        occurred_at=moment,
        title=text_of(info, "title") or file.name,
        summary=excerpt(summary),
        actors=tuple(authors[:MAX_AUTHORS]),
        link="/research",
        details=details,
    )


class ResearchDataSource(DataSource):
    """Papers of the research tag, filtered by event and validation."""

    descriptor = RESEARCH_DESCRIPTOR
    root: Path = LIBRARY_ROOT

    def is_configured(self) -> bool:
        """
        Research is built in

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Count the papers of the research library

        Returns:
            str: e.g. "12 papers"
        """
        with session_scope() as session:
            count = len(research_files(session))
        return f"{count} paper{'s' if count != 1 else ''}"

    def content_fields(self) -> list[ContentField]:
        """
        Content a paper activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return RESEARCH_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare events and the validated-only toggle

        Returns:
            list[ConfigField]: fields
        """
        return [
            ConfigField(
                "events",
                "Events",
                "Which paper events join the feed.",
                "multiselect",
                DEFAULT_EVENTS,
                EVENT_OPTIONS,
                "No event",
            ),
            ConfigField(
                "validated_only",
                "Only validated papers",
                "Skip papers whose metadata you have not checked.",
                "toggle",
                False,
            ),
        ]

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read paper additions and summaries of the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per paper event
        """
        config = self.config()
        events = config.choices("events")
        with session_scope() as session:
            papers = research_files(session)
            results = processed_files(
                session,
                (window.start, window.end),
                ["summary"] if "summary" in events else [],
            )
        added = [
            (file, moment)
            for file, moment in (
                uploaded_files(self.root, days_of(window.start, window.end))
                if "added" in events
                else []
            )
            if file.path in papers
        ]
        summarized = [
            (parse_shared(item.file), item) for item in results if item.file in papers
        ]
        files = [file for file, _ in added] + [
            file for file, _ in summarized if file is not None
        ]
        infos = infos_of(files)
        activities = [
            paper_activity(file, "added", moment, infos.get(file.path, {}), "")
            for file, moment in added
        ]
        activities += [
            paper_activity(
                file, "summary", item.occurred_at, infos.get(file.path, {}), item.text
            )
            for file, item in summarized
            if file is not None
        ]
        if config.flag("validated_only"):
            return [
                item for item in activities if item.details.get("validated") == "yes"
            ]
        return activities

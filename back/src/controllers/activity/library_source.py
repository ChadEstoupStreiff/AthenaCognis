"""Library data source: files uploaded and processed (summary, transcription, OCR, tree)."""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from controllers.activity.base import (
    SUMMARY_CONTENT,
    Activity,
    ContentField,
    DataSource,
    SourceDescriptor,
    TimeRange,
)
from controllers.activity.common import (
    LIBRARY_ROOT,
    ProcessedFile,
    SharedFile,
    days_of,
    excerpt,
    library_folders,
    parse_shared,
    processed_files,
    research_files,
    session_scope,
    tag_names,
    projects_by_file,
    tags_by_file,
    uploaded_files,
)
from controllers.activity.config import ConfigField, SourceConfig, options_of

LIBRARY_DESCRIPTOR = SourceDescriptor(
    "library",
    "Library",
    "pi pi-folder-open",
    "Files uploaded, summarized, transcribed or OCR'd.",
    "athenacognis",
)
EVENT_OPTIONS = options_of(
    [
        ("uploaded", "Uploaded"),
        ("summary", "Summarized"),
        ("transcription", "Transcribed"),
        ("ocr", "Text extracted (OCR)"),
        ("tree", "Section tree built"),
    ]
)
DEFAULT_EVENTS = ("uploaded", "summary", "transcription")
EVENT_TITLES = {
    "uploaded": "Uploaded",
    "summary": "Summarized",
    "transcription": "Transcribed",
    "ocr": "Text extracted",
    "tree": "Section tree built",
}

LIBRARY_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Job result excerpt"),
    ContentField("folder", "Folder", default=False),
    ContentField("event", "Event"),
    ContentField("tags", "Tags"),
    ContentField("keywords", "Keywords", default=False),
    ContentField("projects", "Projects"),
]


def keep_file(
    file: SharedFile, config: SourceConfig, tags: set[str], skipped: set[str]
) -> bool:
    """
    Apply the folder, tag and research filters to one file

    Args:
        file (SharedFile): file
        config (SourceConfig): library settings
        tags (set[str]): tags of the file
        skipped (set[str]): files left to another source (research papers)
    Returns:
        bool: True when the file passes every filter
    """
    folders = config.choices("folders")
    wanted_tags = config.choices("tags")
    if file.path in skipped:
        return False
    if folders and file.folder not in folders:
        return False
    return not wanted_tags or bool(tags & set(wanted_tags))


@dataclass(frozen=True)
class FileLabels:
    """Tags and projects of one file."""

    tags: frozenset[str] = frozenset()
    projects: frozenset[str] = frozenset()


NO_LABELS = FileLabels()


def file_activity(
    file: SharedFile,
    kind: str,
    moment: datetime,
    labels: FileLabels,
    result: ProcessedFile | None,
) -> Activity:
    """
    Build the activity of one file event

    Args:
        file (SharedFile): file
        kind (str): event kind
        moment (datetime): when it happened
        labels (FileLabels): tags and projects of the file
        result (ProcessedFile | None): job result, None for an upload
    Returns:
        Activity: normalized activity
    """
    details = {"folder": file.folder, "event": EVENT_TITLES[kind]}
    if labels.tags:
        details["tags"] = ", ".join(sorted(labels.tags))
    if labels.projects:
        details["projects"] = ", ".join(sorted(labels.projects))
    if result is not None and result.keywords:
        details["keywords"] = excerpt(result.keywords, 120)
    return Activity(
        id=f"library:{kind}:{file.path}",
        source=LIBRARY_DESCRIPTOR.key,
        kind=kind,
        occurred_at=moment,
        title=file.name,
        summary=excerpt(result.text) if result is not None else "",
        link=file.link,
        details=details,
    )


class LibraryDataSource(DataSource):
    """Uploads and job results of the library, filtered by event, folder and tag."""

    descriptor = LIBRARY_DESCRIPTOR
    root: Path = LIBRARY_ROOT

    def is_configured(self) -> bool:
        """
        Library is built in

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Describe the picked events

        Returns:
            str: e.g. "3 event types"
        """
        count = len(self.config().choices("events"))
        return f"{count} event type{'s' if count != 1 else ''}"

    def content_fields(self) -> list[ContentField]:
        """
        Content a file activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return LIBRARY_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare events, folders, tags and the research toggle

        Returns:
            list[ConfigField]: fields
        """
        with session_scope() as session:
            tags = tag_names(session)
        folders = library_folders(self.root)
        return [
            ConfigField(
                "events",
                "Events",
                "Which file events join the feed.",
                "multiselect",
                DEFAULT_EVENTS,
                EVENT_OPTIONS,
                "No event",
            ),
            ConfigField(
                "folders",
                "Only from folder",
                "None picked: every folder.",
                "multiselect",
                (),
                options_of([(name, name) for name in folders]),
                "All folders",
            ),
            ConfigField(
                "tags",
                "Only files tagged",
                "None picked: tagged or not.",
                "multiselect",
                (),
                options_of([(name, name) for name in tags]),
                "Any tag",
            ),
            ConfigField(
                "skip_research",
                "Skip research papers",
                "Papers already show in the Research source.",
                "toggle",
                True,
            ),
        ]

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read uploads and job results of the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per file event
        """
        config = self.config()
        events = config.choices("events")
        uploads = (
            uploaded_files(self.root, days_of(window.start, window.end))
            if "uploaded" in events
            else []
        )
        with session_scope() as session:
            results = processed_files(session, (window.start, window.end), events)
            skipped = research_files(session) if config.flag("skip_research") else set()
            paths = [file.path for file, _ in uploads] + [item.file for item in results]
            tags = tags_by_file(session, paths)
            projects = projects_by_file(session, paths)
        labels = {
            path: FileLabels(
                frozenset(tags.get(path, set())), frozenset(projects.get(path, set()))
            )
            for path in paths
        }
        events_found: list[tuple[SharedFile, str, datetime, ProcessedFile | None]] = [
            (file, "uploaded", moment, None) for file, moment in uploads
        ]
        for result in results:
            file = parse_shared(result.file)
            if file is not None:
                events_found.append((file, result.kind, result.occurred_at, result))
        return [
            file_activity(file, kind, moment, labels.get(file.path, NO_LABELS), result)
            for file, kind, moment, result in events_found
            if keep_file(
                file, config, set(labels.get(file.path, NO_LABELS).tags), skipped
            )
        ]

"""Catalog of activity data sources: implemented ones and planned (incoming) ones."""

from controllers.activity.activitywatch_source import ActivityWatchDataSource
from controllers.activity.agenda_source import AgendaDataSource
from controllers.activity.base import DataSource, SourceDescriptor, SourceInfo
from controllers.activity.github_source import GitHubDataSource
from controllers.activity.library_source import LibraryDataSource
from controllers.activity.local_files_source import LocalFilesDataSource
from controllers.activity.mail_source import MailDataSource
from controllers.activity.overleaf_source import OverleafDataSource
from controllers.activity.research_source import ResearchDataSource
from controllers.activity.time_source import TimeDataSource
from controllers.activity.work_source import WorkDataSource

INCOMING_DETAIL = "Incoming"


class UnknownSourceError(KeyError):
    """No source has this key."""


class IncomingSourceError(LookupError):
    """Source is planned but not implemented yet."""


IMPLEMENTED: tuple[DataSource, ...] = (
    MailDataSource(),
    LibraryDataSource(),
    WorkDataSource(),
    TimeDataSource(),
    ResearchDataSource(),
    ActivityWatchDataSource(),
    AgendaDataSource(),
    LocalFilesDataSource(),
    GitHubDataSource(),
    OverleafDataSource(),
)

INCOMING: tuple[SourceDescriptor, ...] = (
    SourceDescriptor(
        "gitlab",
        "GitLab",
        "pi pi-code",
        "Commits, merge requests, pipelines and issues.",
    ),
    SourceDescriptor(
        "mlflow",
        "MLflow",
        "pi pi-chart-line",
        "Experiment runs, metrics and registered models.",
    ),
    SourceDescriptor(
        "cluster",
        "Cloud cluster",
        "pi pi-server",
        "Jobs submitted, finished or failed on the cluster.",
    ),
    SourceDescriptor(
        "slack",
        "Slack",
        "pi pi-slack",
        "Messages, mentions and threads you took part in.",
    ),
    SourceDescriptor(
        "discord", "Discord", "pi pi-discord", "Messages, mentions and DMs."
    ),
    SourceDescriptor(
        "teams", "Microsoft Teams", "pi pi-microsoft", "Chats, channel posts and calls."
    ),
    SourceDescriptor(
        "notes",
        "Notes",
        "pi pi-pen-to-square",
        "Notes written or edited.",
        "athenacognis",
    ),
    SourceDescriptor(
        "projects",
        "Projects",
        "pi pi-briefcase",
        "Files and tasks added to projects.",
        "athenacognis",
    ),
    SourceDescriptor(
        "assistant",
        "Assistant",
        "pi pi-comments",
        "Conversations held with the assistant.",
        "athenacognis",
    ),
    SourceDescriptor(
        "people", "People", "pi pi-users", "Contacts added or updated.", "athenacognis"
    ),
)


def all_sources() -> list[SourceInfo]:
    """
    Describe every source: implemented ones with their live state, then incoming ones

    Returns:
        list[SourceInfo]: sources
    """
    incoming = [
        SourceInfo(descriptor, "incoming", INCOMING_DETAIL) for descriptor in INCOMING
    ]
    return [source.info() for source in IMPLEMENTED] + incoming


def get_source(key: str) -> DataSource:
    """
    Find an implemented source

    Args:
        key (str): source key
    Returns:
        DataSource: source
    Raises:
        IncomingSourceError: source is only planned
        UnknownSourceError: no source has this key
    """
    for source in IMPLEMENTED:
        if source.key == key:
            return source
    if any(descriptor.key == key for descriptor in INCOMING):
        raise IncomingSourceError(f"Data source '{key}' is not available yet.")
    raise UnknownSourceError(f"Unknown data source '{key}'.")

"""Overleaf data source: edits, labelled versions and comments of watched projects."""

import logging
from dataclasses import dataclass, replace

from controllers.activity.base import (
    PEOPLE_CONTENT,
    SUMMARY_CONTENT,
    Activity,
    ContentField,
    DataSource,
    InvalidSettingError,
    SourceDescriptor,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.config import ConfigField, SourceConfig, options_of
from controllers.activity.overleaf_client import (
    Fetch,
    JsonObject,
    OverleafClient,
    OverleafError,
    cookie_header,
    http_json,
    normalize_server,
    parse_project,
)
from controllers.activity.overleaf_events import (
    COMMENT_KIND,
    EDIT_KIND,
    KIND_LABELS,
    MAX_CHANGES_CHARS,
    MAX_DIFF_FILES,
    OVERLEAF_SOURCE,
    VERSION_KIND,
    Project,
    clip,
    diff_text,
    edit_activity,
    history_labels,
    is_by,
    label_activity,
    moment_of,
    obj,
    strings,
    text,
    thread_activities,
    user_names,
    version_of,
)

LOGGER = logging.getLogger(__name__)

OVERLEAF_DESCRIPTOR = SourceDescriptor(
    OVERLEAF_SOURCE,
    "Overleaf",
    "pi pi-file-edit",
    "LaTeX projects edited, labelled versions and comments.",
)

CHANGES_CONTENT = "changes"
OVERLEAF_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Comment text / file operations"),
    ContentField(PEOPLE_CONTENT, "Authors"),
    ContentField("project", "Project"),
    ContentField("files", "Edited files"),
    ContentField(CHANGES_CONTENT, "Text changes (diffs)", default=False),
]


@dataclass(frozen=True)
class ReadPlan:
    """What to read from each project: whose actions, which kinds, with diffs or not."""

    window: TimeRange
    # Only this user's actions; "" keeps everyone.
    user_id: str
    # Picked kinds; empty keeps every kind.
    kinds: frozenset[str]
    with_changes: bool

    def wants(self, kind: str) -> bool:
        """
        Tell whether a kind is picked

        Args:
            kind (str): activity kind
        Returns:
            bool: True when picked (or nothing picked)
        """
        return not self.kinds or kind in self.kinds


def parse_all(links: tuple[str, ...]) -> list[str]:
    """
    Read every project link, without duplicates

    Args:
        links (tuple[str, ...]): links as entered
    Returns:
        list[str]: project ids, in entry order
    Raises:
        InvalidSettingError: a link cannot be read
    """
    try:
        ids = [parse_project(link) for link in links]
    except OverleafError as error:
        raise InvalidSettingError(str(error)) from error
    return list(dict.fromkeys(ids))


def plural_projects(count: int) -> str:
    """
    Format a project count

    Args:
        count (int): number of projects
    Returns:
        str: "1 project" or "N projects"
    """
    return f"{count} project{'' if count == 1 else 's'}"


class OverleafDataSource(DataSource):
    """Edits, labelled versions and comments of watched Overleaf projects."""

    descriptor = OVERLEAF_DESCRIPTOR
    fetch: Fetch = staticmethod(http_json)

    def __init__(self) -> None:
        """
        Start without a client (built on first use, per server and cookie)

        Returns:
            None
        """
        self._client: OverleafClient | None = None

    def raw_text(self, name: str) -> str:
        """
        Text setting, read directly (config() depends on the suggestions)

        Args:
            name (str): setting name
        Returns:
            str: trimmed value, "" when unset
        """
        value = self.read_setting(self.setting_key(name))
        return value.strip() if isinstance(value, str) else ""

    def server(self) -> str:
        """
        Overleaf server address

        Returns:
            str: normalized address, overleaf.com when unset
        Raises:
            InvalidSettingError: address cannot be read
        """
        try:
            return normalize_server(self.raw_text("server"))
        except OverleafError as error:
            raise InvalidSettingError(str(error)) from error

    def client(self) -> OverleafClient:
        """
        Client of the current server and cookie, keeping its cache while both are unchanged

        Returns:
            OverleafClient: client
        Raises:
            InvalidSettingError: no session cookie, or bad server address
        """
        server = self.server()
        cookie = cookie_header(self.raw_text("cookie"), server)
        if not cookie:
            raise InvalidSettingError("Paste your Overleaf session cookie.")
        current = self._client
        if current is None or (current.server, current.cookie) != (server, cookie):
            current = OverleafClient(server, cookie, self.fetch)
            self._client = current
        return current

    def is_configured(self) -> bool:
        """
        Cookie and links are entered on the Activity page itself

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Count the watched projects

        Returns:
            str: "N projects" or "Nothing watched"
        """
        count = len(self.config().lines("projects"))
        return plural_projects(count) if count else "Nothing watched"

    def suggestions(self) -> list[tuple[str, str]]:
        """
        Projects of the session not watched yet

        Returns:
            list[tuple[str, str]]: (project link, name), empty without cookie or on failure
        """
        try:
            client = self.client()
            watched = set(parse_all(self.config().lines("projects")))
            projects = client.projects()
        except (OverleafError, InvalidSettingError) as error:
            LOGGER.warning("Overleaf suggestions unavailable: %s", error)
            return []
        return [
            (f"{client.server}/project/{project_id}", name or project_id)
            for project_id, name in projects.items()
            if project_id not in watched
        ]

    def projects_field(self, found: list[tuple[str, str]] | None = None) -> ConfigField:
        """
        Declare the project link field

        Args:
            found (list[tuple[str, str]] | None): (link, name) suggestions, None for none
        Returns:
            ConfigField: field
        """
        return ConfigField(
            "projects",
            "Watched projects",
            "Project links (e.g. https://www.overleaf.com/project/<id>), one per line.",
            "lines",
            "",
            options_of(found or []),
        )

    def view_fields(self) -> list[ConfigField]:
        """
        Fields for the UI: the project field carries the suggestions

        Returns:
            list[ConfigField]: fields
        """
        suggested = self.projects_field(self.suggestions())
        return [
            suggested if item.name == suggested.name else item
            for item in self.all_config_fields()
        ]

    def content_fields(self) -> list[ContentField]:
        """
        Content an Overleaf activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return OVERLEAF_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare server, cookie, projects and filters (no network: suggestions are in view_fields)

        Returns:
            list[ConfigField]: fields
        """
        return [
            ConfigField(
                "server",
                "Overleaf server",
                "Leave empty for overleaf.com; else the address of a self-hosted "
                "Overleaf (e.g. https://latex.example.org).",
                "text",
                "",
            ),
            ConfigField(
                "cookie",
                "Session cookie",
                "Overleaf has no public API. Log in to Overleaf in a browser, open "
                "the developer tools → Storage/Application → Cookies, and copy the "
                "value of 'overleaf_session2' (self-hosted: 'overleaf.sid'). "
                "Paste a fresh one when it expires.",
                "text",
                "",
                secret=True,
            ),
            self.projects_field(),
            ConfigField(
                "only_mine",
                "Only my activity",
                "Leave out what collaborators did in the watched projects.",
                "toggle",
                True,
            ),
            ConfigField(
                "kinds",
                "Activity kinds",
                "None picked: every kind.",
                "multiselect",
                (),
                options_of(KIND_LABELS),
                "All kinds",
            ),
        ]

    def read_plan(self, config: SourceConfig, window: TimeRange) -> ReadPlan:
        """
        Build the reading plan from the settings

        Args:
            config (SourceConfig): Overleaf settings
            window (TimeRange): time window
        Returns:
            ReadPlan: plan
        Raises:
            SourceUnavailableError: Overleaf did not answer about the session owner
        """
        user_id = ""
        if config.flag("only_mine"):
            try:
                user_id = text(self.client().me(), "id")
            except OverleafError as error:
                raise SourceUnavailableError(f"Overleaf session: {error}") from error
            if not user_id:
                raise SourceUnavailableError("Overleaf session: account unknown.")
        return ReadPlan(
            window,
            user_id,
            frozenset(config.choices("kinds")),
            self.includes(config, CHANGES_CONTENT),
        )

    def watched(self, config: SourceConfig) -> list[Project]:
        """
        Watched projects with their names

        Args:
            config (SourceConfig): Overleaf settings
        Returns:
            list[Project]: projects, named after Overleaf (the id when unknown)
        Raises:
            InvalidSettingError: a link cannot be read
            SourceUnavailableError: the project list could not be read
        """
        ids = parse_all(config.lines("projects"))
        client = self.client()
        try:
            names = client.projects()
        except OverleafError as error:
            raise SourceUnavailableError(f"Overleaf projects: {error}") from error
        return [
            Project(item, names.get(item) or item, f"{client.server}/project/{item}")
            for item in ids
        ]

    def changes(self, update: JsonObject, project: Project) -> str:
        """
        Text changes of a history update, file by file

        Args:
            update (JsonObject): history update (fromV, toV, pathnames)
            project (Project): project
        Returns:
            str: "## file" headers followed by +/- lines, clipped; "" when unreadable
        """
        versions = (version_of(update, "fromV"), version_of(update, "toV"))
        parts: list[str] = []
        for pathname in strings(update, "pathnames")[:MAX_DIFF_FILES]:
            try:
                body = diff_text(self.client().diff(project.id, pathname, versions))
            except OverleafError as error:
                LOGGER.warning("Overleaf diff of %s unavailable: %s", pathname, error)
                continue
            if body:
                parts.append(f"## {pathname}\n{body}")
        return clip("\n".join(parts), MAX_CHANGES_CHARS)

    def edits(
        self, updates: list[JsonObject], project: Project, plan: ReadPlan
    ) -> list[Activity]:
        """
        Edits of the window, with their text changes when included

        Args:
            updates (list[JsonObject]): history updates
            project (Project): project
            plan (ReadPlan): reading plan
        Returns:
            list[Activity]: edits
        """
        found: list[Activity] = []
        for update in updates:
            moment = moment_of(obj(update, "meta").get("end_ts"))
            if moment is None or not plan.window.contains(moment):
                continue
            if plan.user_id and not is_by(update, plan.user_id):
                continue
            activity = edit_activity(update, project)
            if activity is None:
                continue
            if plan.with_changes and (body := self.changes(update, project)):
                activity = replace(
                    activity, details={**activity.details, CHANGES_CONTENT: body}
                )
            found.append(activity)
        return found

    def history_activities(self, project: Project, plan: ReadPlan) -> list[Activity]:
        """
        Edits and labelled versions of one project

        Args:
            project (Project): project
            plan (ReadPlan): reading plan
        Returns:
            list[Activity]: activities
        Raises:
            OverleafError: history could not be read
        """
        if not (plan.wants(EDIT_KIND) or plan.wants(VERSION_KIND)):
            return []
        updates = self.client().history(project.id, plan.window.start)
        found = self.edits(updates, project, plan) if plan.wants(EDIT_KIND) else []
        if plan.wants(VERSION_KIND):
            names = user_names(updates)
            labels = history_labels(updates, plan.user_id)
            found += [
                item
                for item in (label_activity(label, project, names) for label in labels)
                if item is not None
            ]
        return found

    def comment_activities(self, project: Project, plan: ReadPlan) -> list[Activity]:
        """
        Comments, replies and resolutions of one project

        Args:
            project (Project): project
            plan (ReadPlan): reading plan
        Returns:
            list[Activity]: comments
        Raises:
            OverleafError: threads could not be read
        """
        if not plan.wants(COMMENT_KIND):
            return []
        found: list[Activity] = []
        for thread_id, thread in self.client().threads(project.id).items():
            if isinstance(thread, dict):
                found += thread_activities(thread_id, thread, project, plan.user_id)
        return found

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the edits, labelled versions and comments of the watched projects

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: activities, any order
        Raises:
            InvalidSettingError: no cookie, bad server address or bad project link
            SourceUnavailableError: Overleaf could not be read
        """
        config = self.config()
        projects = self.watched(config)
        plan = self.read_plan(config, window)
        found: list[Activity] = []
        for project in self.track(projects, "Reading projects", "projects"):
            try:
                found += self.history_activities(project, plan)
                found += self.comment_activities(project, plan)
            except OverleafError as error:
                raise SourceUnavailableError(
                    f"Overleaf {project.name}: {error}"
                ) from error
        return found

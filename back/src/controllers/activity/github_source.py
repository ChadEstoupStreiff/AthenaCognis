"""GitHub data source: events and fresh commits of watched repositories and organisations."""

import logging
from dataclasses import dataclass

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
from controllers.activity.github_client import (
    Fetch,
    GitHubClient,
    GitHubError,
    JsonObject,
    http_json,
    parse_org,
    parse_repo,
)
from controllers.activity.github_code import add_code_all
from controllers.activity.github_commits import read_commits, unpublished
from controllers.activity.github_enrich import enrich_all
from controllers.activity.github_events import (
    GITHUB_SOURCE,
    KIND_LABELS,
    event_activity,
    event_actor,
    event_kind,
    event_moment,
    text,
)

LOGGER = logging.getLogger(__name__)

GITHUB_DESCRIPTOR = SourceDescriptor(
    GITHUB_SOURCE,
    "GitHub",
    "pi pi-github",
    "Commits, pull requests, reviews and issues.",
)

GITHUB_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Commit messages / PR text"),
    ContentField(PEOPLE_CONTENT, "Author"),
    ContentField("repo", "Repository"),
    ContentField("branch", "Branch"),
    ContentField("files", "Changed files", default=False),
    ContentField("changes", "Pull request size"),
    ContentField("code", "Code changes (diffs)", default=False),
]


@dataclass(frozen=True)
class Watched:
    """One events feed to read: a repository or an organisation."""

    label: str
    path: str


@dataclass(frozen=True)
class Suggestions:
    """Repositories and organisations of the token owner not watched yet."""

    repos: list[str]
    orgs: list[str]


def plural(count: int, singular: str, plural_form: str) -> str:
    """
    Format a count with its noun

    Args:
        count (int): count
        singular (str): noun for one
        plural_form (str): noun for several
    Returns:
        str: "1 singular" or "N plural_form"
    """
    return f"{count} {singular if count == 1 else plural_form}"


def parse_all(links: tuple[str, ...], is_org: bool) -> list[str]:
    """
    Read every repository (or organisation) link, without duplicates

    Args:
        links (tuple[str, ...]): links as entered
        is_org (bool): organisation links
    Returns:
        list[str]: "owner/repo" (or org logins), in entry order
    Raises:
        InvalidSettingError: a link cannot be read
    """
    parse = parse_org if is_org else parse_repo
    try:
        names = [parse(link) for link in links]
    except GitHubError as error:
        raise InvalidSettingError(str(error)) from error
    return list(dict.fromkeys(names))


@dataclass(frozen=True)
class EventFilter:
    """Which events reach the feed (checked before the costly completion)."""

    window: TimeRange
    kinds: frozenset[str]
    # Only events of this login; "" keeps everyone.
    actor: str

    def keeps(self, event: JsonObject) -> bool:
        """
        Tell whether an event is in the window, of a picked kind and by the actor

        Args:
            event (JsonObject): event
        Returns:
            bool: True when kept
        """
        kind, moment = event_kind(event), event_moment(event)
        if kind is None or moment is None or not self.window.contains(moment):
            return False
        if self.kinds and kind not in self.kinds:
            return False
        return not self.actor or event_actor(event).lower() == self.actor.lower()


def newest_first(events: list[JsonObject]) -> list[JsonObject]:
    """
    Sort events by creation moment, newest first

    Args:
        events (list[JsonObject]): events
    Returns:
        list[JsonObject]: sorted copy
    """
    return sorted(events, key=lambda event: text(event, "created_at"), reverse=True)


def org_path(org: str, login: str) -> str:
    """
    Events feed of an organisation

    Args:
        org (str): organisation login
        login (str): token owner login, "" without token
    Returns:
        str: private dashboard feed with a login, else the public feed
    """
    return f"/users/{login}/events/orgs/{org}" if login else f"/orgs/{org}/events"


class GitHubDataSource(DataSource):
    """Events of watched GitHub repositories and organisations."""

    descriptor = GITHUB_DESCRIPTOR
    fetch: Fetch = staticmethod(http_json)

    def __init__(self) -> None:
        """
        Start without a client (built on first use, per token)

        Returns:
            None
        """
        self._client: GitHubClient | None = None

    def token(self) -> str:
        """
        Token setting, read directly (config() depends on the suggestions)

        Returns:
            str: token, "" when unset
        """
        value = self.read_setting(self.setting_key("token"))
        return value.strip() if isinstance(value, str) else ""

    def client(self) -> GitHubClient:
        """
        Client of the current token, keeping its cache while the token is unchanged

        Returns:
            GitHubClient: client
        """
        token = self.token()
        if self._client is None or self._client.token != token:
            self._client = GitHubClient(token, self.fetch)
        return self._client

    def is_configured(self) -> bool:
        """
        Links are entered on the Activity page itself (the token is optional)

        Returns:
            bool: always True
        """
        return True

    def detail(self) -> str:
        """
        Count the watched repositories

        Returns:
            str: "N repositories" or "Nothing watched"
        """
        config = self.config()
        if not config.lines("repos") and not config.lines("orgs"):
            return "Nothing watched"
        return plural(len(config.lines("repos")), "repository", "repositories")

    def org_repos(self, orgs: list[str]) -> list[str]:
        """
        Most active repositories of each organisation, skipping unreadable ones

        Args:
            orgs (list[str]): organisation logins
        Returns:
            list[str]: "owner/repo", organisation by organisation
        """
        repos: list[str] = []
        for org in orgs:
            try:
                repos += self.client().org_repos(org)
            except GitHubError as error:
                LOGGER.warning("GitHub repositories of %s unavailable: %s", org, error)
        return repos

    def suggestions(self) -> Suggestions:
        """
        Most active own and organisation repositories, and organisations, not watched yet

        Returns:
            Suggestions: names, empty without token or when GitHub fails
        """
        raw = self.config()
        try:
            watched_repos = set(parse_all(raw.lines("repos"), is_org=False))
            watched_orgs = parse_all(raw.lines("orgs"), is_org=True)
            orgs = [name for name in self.client().orgs() if name]
            user_repos = self.client().user_repos()
        except (GitHubError, InvalidSettingError) as error:
            LOGGER.warning("GitHub suggestions unavailable: %s", error)
            return Suggestions([], [])
        repos = user_repos + self.org_repos(list(dict.fromkeys(orgs + watched_orgs)))
        return Suggestions(
            [name for name in dict.fromkeys(repos) if name and name not in watched_repos],
            [name for name in orgs if name not in watched_orgs],
        )

    def link_fields(self, found: Suggestions | None = None) -> list[ConfigField]:
        """
        Declare the repository and organisation link fields

        Args:
            found (Suggestions | None): suggestions to offer, None for none
        Returns:
            list[ConfigField]: fields
        """
        found = found or Suggestions([], [])
        return [
            ConfigField(
                "repos",
                "Watched repositories",
                "Repository links (e.g. https://github.com/owner/repo), one per line.",
                "lines",
                "",
                options_of([(name, name) for name in found.repos]),
            ),
            ConfigField(
                "orgs",
                "Watched organisations",
                "Organisation links (e.g. https://github.com/org), one per line.",
                "lines",
                "",
                options_of([(name, name) for name in found.orgs]),
            ),
        ]

    def view_fields(self) -> list[ConfigField]:
        """
        Fields for the UI: link fields carry the suggestions

        Returns:
            list[ConfigField]: fields
        """
        suggested = {item.name: item for item in self.link_fields(self.suggestions())}
        return [suggested.get(item.name, item) for item in self.all_config_fields()]

    def content_fields(self) -> list[ContentField]:
        """
        Content a GitHub activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return GITHUB_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare token, links, login and filters (no network: suggestions are in view_fields)

        Returns:
            list[ConfigField]: fields
        """
        return [
            ConfigField(
                "token",
                "Personal access token",
                "Read access to repositories and organisations. Optional for public "
                "repositories (60 requests per hour without it).",
                "text",
                "",
                secret=True,
            ),
            *self.link_fields(),
            ConfigField(
                "only_mine",
                "Only my activity",
                "Leave out what others did in the watched repositories.",
                "toggle",
                True,
            ),
            ConfigField(
                "username",
                "GitHub username",
                "Used by 'Only my activity' when no token is set.",
                "text",
                "",
            ),
            ConfigField(
                "kinds",
                "Event kinds",
                "None picked: every kind.",
                "multiselect",
                (),
                options_of(KIND_LABELS),
                "All kinds",
            ),
        ]

    def watched(self, config: SourceConfig, login: str) -> list[Watched]:
        """
        Events feeds of the watched repositories and organisations

        Args:
            config (SourceConfig): GitHub settings
            login (str): token owner login, "" without token
        Returns:
            list[Watched]: feeds
        Raises:
            InvalidSettingError: a link cannot be read
        """
        repos = parse_all(config.lines("repos"), is_org=False)
        orgs = parse_all(config.lines("orgs"), is_org=True)
        return [Watched(repo, f"/repos/{repo}/events") for repo in repos] + [
            Watched(org, org_path(org, login)) for org in orgs
        ]

    def read_events(self, feeds: list[Watched], window: TimeRange) -> list[JsonObject]:
        """
        Read every feed, each event once (repositories and organisations overlap)

        Args:
            feeds (list[Watched]): feeds
            window (TimeRange): time window
        Returns:
            list[JsonObject]: events
        Raises:
            SourceUnavailableError: a feed could not be read (message names it)
        """
        events: dict[str, JsonObject] = {}
        for feed in self.track(feeds, "Reading events", "feeds"):
            try:
                batch = self.client().events(feed.path, window.start)
            except GitHubError as error:
                raise SourceUnavailableError(f"GitHub {feed.label}: {error}") from error
            events.update((str(event.get("id")), event) for event in batch)
        return list(events.values())

    def me(self, config: SourceConfig) -> str:
        """
        Login used by "Only my activity"

        Args:
            config (SourceConfig): GitHub settings
        Returns:
            str: token owner login, else the username setting, "" when neither
        Raises:
            SourceUnavailableError: GitHub did not answer about the token owner
        """
        try:
            return self.client().login() or config.text("username")
        except GitHubError as error:
            raise SourceUnavailableError(f"GitHub token: {error}") from error

    def feed_filter(
        self, config: SourceConfig, window: TimeRange, login: str
    ) -> EventFilter:
        """
        Build the window / kind / actor filter of the feed

        Args:
            config (SourceConfig): GitHub settings
            window (TimeRange): time window
            login (str): login used by "Only my activity", "" when unknown
        Returns:
            EventFilter: filter
        Raises:
            InvalidSettingError: "Only my activity" without token nor username
        """
        only_mine = config.flag("only_mine")
        if only_mine and not login:
            raise InvalidSettingError(
                "'Only my activity' needs a token or a GitHub username."
            )
        return EventFilter(
            window, frozenset(config.choices("kinds")), login if only_mine else ""
        )

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the events, plus commits not published as pushes yet, of the watched sources

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per supported event or unpublished commit
        Raises:
            InvalidSettingError: bad link, or "Only my activity" without token nor username
            SourceUnavailableError: GitHub could not be read
        """
        config = self.config()
        login = self.me(config)
        keep = self.feed_filter(config, window, login)
        token_login = login if self.token() else ""
        events = self.read_events(self.watched(config, token_login), window)
        completed = enrich_all(
            newest_first([event for event in events if keep.keeps(event)]),
            self.client(),
            lambda batch: self.track(batch, "Completing", "events"),
        )
        repos = parse_all(config.lines("repos"), is_org=False)
        commits = read_commits(
            self.client(), self.track(repos, "Reading commits", "repositories"), window
        )
        fresh = [
            commit for commit in unpublished(commits, completed) if keep.keeps(commit)
        ]
        merged = newest_first(completed + fresh)
        if self.includes(config, "code"):
            merged = add_code_all(
                merged,
                self.client(),
                lambda batch: self.track(batch, "Reading code", "changes"),
            )
        return [item for item in map(event_activity, merged) if item is not None]

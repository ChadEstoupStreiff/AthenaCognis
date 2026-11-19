"""GitHub data source: events of watched repositories and organisations."""

import logging
from dataclasses import dataclass

from controllers.activity.base import (
    Activity,
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
        Count the watched repositories and organisations

        Returns:
            str: "N repositories · M organisations" or "Nothing watched"
        """
        config = self.config()
        repos, orgs = len(config.lines("repos")), len(config.lines("orgs"))
        parts = [plural(repos, "repository", "repositories")] if repos else []
        parts += [plural(orgs, "organisation", "organisations")] if orgs else []
        return " · ".join(parts) or "Nothing watched"

    def suggestions(self) -> Suggestions:
        """
        Own and organisation repositories (newest first) and organisations not watched yet

        Returns:
            Suggestions: names, empty without token or when GitHub fails
        """
        raw = self.config()
        try:
            repos, orgs = self.client().user_repos(), self.client().orgs()
            watched_repos = set(parse_all(raw.lines("repos"), is_org=False))
            watched_orgs = set(parse_all(raw.lines("orgs"), is_org=True))
        except (GitHubError, InvalidSettingError) as error:
            LOGGER.warning("GitHub suggestions unavailable: %s", error)
            return Suggestions([], [])
        return Suggestions(
            [name for name in repos if name and name not in watched_repos],
            [name for name in orgs if name and name not in watched_orgs],
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
        for feed in feeds:
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

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the events of the watched repositories and organisations in the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per supported event
        Raises:
            InvalidSettingError: bad link, or "Only my activity" without token nor username
            SourceUnavailableError: GitHub could not be read
        """
        config = self.config()
        login = self.me(config)
        only_mine = config.flag("only_mine")
        if only_mine and not login:
            raise InvalidSettingError(
                "'Only my activity' needs a token or a GitHub username."
            )
        token_login = login if self.token() else ""
        events = self.read_events(self.watched(config, token_login), window)
        keep = EventFilter(
            window, frozenset(config.choices("kinds")), login if only_mine else ""
        )
        kept = sorted(
            (event for event in events if keep.keeps(event)),
            key=lambda event: text(event, "created_at"),
            reverse=True,
        )
        completed = enrich_all(kept, self.client())
        return [item for item in map(event_activity, completed) if item is not None]

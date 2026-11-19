"""ActivityWatch data source: time spent per app and website, by hour."""

import logging
import time
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from controllers.activity.activitywatch_client import (
    AFK_TYPE,
    APP_KEY,
    DOMAIN_KEY,
    TITLE_KEY,
    WEB_TYPE,
    WINDOW_TYPE,
    ActivityWatchClient,
    ActivityWatchError,
    Bucket,
    Fetch,
    MergedEvent,
    Slot,
    http_json,
    time_slots,
    usage_query,
    validate_url,
)
from controllers.activity.base import (
    SUMMARY_CONTENT,
    Activity,
    ContentField,
    DataSource,
    SourceDescriptor,
    SourceUnavailableError,
    TimeRange,
)
from controllers.activity.config import ConfigField, SourceConfig, options_of

LOGGER = logging.getLogger(__name__)

ACTIVITYWATCH_DESCRIPTOR = SourceDescriptor(
    "activitywatch",
    "ActivityWatch",
    "pi pi-stopwatch",
    "Time spent per application, window and website.",
)
# Backend runs in Docker, ActivityWatch on the host.
DEFAULT_URL = "http://host.docker.internal:5600"
PROBE_TIMEOUT_SECONDS = 2.0
QUERY_TIMEOUT_SECONDS = 30.0
PROBE_TTL_SECONDS = 30.0
SLOT_LENGTH = timedelta(hours=1)
MIN_SECONDS = 60.0
SHORT_SECONDS = 300.0
SECONDS_PER_MINUTE = 60
TOP_TITLES = 3
APP_KIND = "app"
WEB_KIND = "web"
# Lock screen and placeholder apps: no work happens there.
IGNORED_APPS = frozenset(
    {"loginwindow", "ScreenSaverEngine", "LockApp.exe", "unknown", ""}
)

ACTIVITYWATCH_CONTENT = [
    ContentField(SUMMARY_CONTENT, "Window titles"),
    ContentField("duration", "Duration"),
    ContentField("device", "Device", default=False),
]


@dataclass(frozen=True)
class Usage:
    """Time spent on one app (or domain) in one slot, with its top titles."""

    label: str
    seconds: float
    titles: tuple[tuple[str, float], ...]


@dataclass(frozen=True)
class TrackedBucket:
    """Bucket read by the feed, with its AFK bucket and activity kind."""

    bucket: Bucket
    afk_id: str | None
    kind: str


def minutes_text(seconds: float) -> str:
    """
    Format a duration in whole minutes

    Args:
        seconds (float): duration
    Returns:
        str: "N min", at least 1
    """
    return f"{max(1, round(seconds / SECONDS_PER_MINUTE))} min"


def top_titles(durations: dict[str, float]) -> tuple[tuple[str, float], ...]:
    """
    Keep the longest non-empty titles

    Args:
        durations (dict[str, float]): seconds per title
    Returns:
        tuple[tuple[str, float], ...]: up to TOP_TITLES (title, seconds), longest first
    """
    ranked = sorted(
        ((title, seconds) for title, seconds in durations.items() if title.strip()),
        key=lambda pair: pair[1],
        reverse=True,
    )
    return tuple(ranked[:TOP_TITLES])


def group_usage(
    events: Sequence[MergedEvent], key: str, min_seconds: float
) -> list[Usage]:
    """
    Sum merged events per app (or domain), dropping ignored apps and short usage

    Args:
        events (Sequence[MergedEvent]): events merged by key and title
        key (str): grouping key (APP_KEY or DOMAIN_KEY)
        min_seconds (float): minimum total to keep a group
    Returns:
        list[Usage]: usage per label
    """
    titles: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for event in events:
        label = event.data.get(key, "")
        if label not in IGNORED_APPS:
            titles[label][event.data.get(TITLE_KEY, "")] += event.seconds
    usages = [
        Usage(label, sum(durations.values()), top_titles(durations))
        for label, durations in titles.items()
    ]
    return [usage for usage in usages if usage.seconds >= min_seconds]


def usage_activity(
    usage: Usage, slot_start: datetime, tracked: TrackedBucket, share_titles: bool
) -> Activity:
    """
    Build the activity of one app (or domain) in one slot

    Args:
        usage (Usage): time spent
        slot_start (datetime): slot start (naive UTC)
        tracked (TrackedBucket): bucket the usage comes from
        share_titles (bool): put window titles in the summary
    Returns:
        Activity: normalized activity
    """
    host = tracked.bucket.hostname
    summary = (
        "; ".join(
            f"{title} ({minutes_text(seconds)})" for title, seconds in usage.titles
        )
        if share_titles
        else ""
    )
    return Activity(
        id=f"activitywatch:{host}:{tracked.kind}:{slot_start:%Y%m%dT%H%M}:{usage.label}",
        source=ACTIVITYWATCH_DESCRIPTOR.key,
        kind=tracked.kind,
        occurred_at=slot_start,
        title=usage.label,
        summary=summary,
        details={"duration": minutes_text(usage.seconds), "device": host},
    )


def afk_bucket_of(bucket: Bucket, buckets: Sequence[Bucket]) -> str | None:
    """
    Find the AFK bucket of a bucket's device

    Browser buckets may report an "unknown" host: the only AFK bucket is used then.

    Args:
        bucket (Bucket): window or browser bucket
        buckets (Sequence[Bucket]): every bucket of the server
    Returns:
        str | None: AFK bucket id, None when none matches
    """
    afk = [item for item in buckets if item.type == AFK_TYPE]
    same_host = [item.id for item in afk if item.hostname == bucket.hostname]
    if same_host:
        return same_host[0]
    return afk[0].id if len(afk) == 1 else None


def tracked_buckets(
    buckets: Sequence[Bucket], config: SourceConfig
) -> list[TrackedBucket]:
    """
    Pick the window (and browser) buckets read by the feed

    Args:
        buckets (Sequence[Bucket]): every bucket of the server
        config (SourceConfig): ActivityWatch settings
    Returns:
        list[TrackedBucket]: buckets of the chosen devices
    """
    kinds = {WINDOW_TYPE: APP_KIND}
    if config.flag("web"):
        kinds[WEB_TYPE] = WEB_KIND
    devices = set(config.choices("devices"))
    skip_afk = config.flag("skip_afk")
    return [
        TrackedBucket(
            bucket,
            afk_bucket_of(bucket, buckets) if skip_afk else None,
            kinds[bucket.type],
        )
        for bucket in buckets
        if bucket.type in kinds and (not devices or bucket.hostname in devices)
    ]


def device_names(buckets: Sequence[Bucket]) -> list[str]:
    """
    List the devices that track windows

    Args:
        buckets (Sequence[Bucket]): every bucket of the server
    Returns:
        list[str]: sorted host names
    """
    return sorted({item.hostname for item in buckets if item.type == WINDOW_TYPE})


class ActivityWatchDataSource(DataSource):
    """Hourly app and website usage read from an ActivityWatch server."""

    descriptor = ACTIVITYWATCH_DESCRIPTOR
    fetch: Fetch = staticmethod(http_json)

    def __init__(self) -> None:
        """
        Start with an empty probe cache

        Returns:
            None
        """
        self._probe: tuple[str, float, list[Bucket] | None] | None = None

    def server_url(self) -> str:
        """
        Server URL setting, read directly (config() depends on the probe)

        Returns:
            str: URL, DEFAULT_URL when unset or blank
        """
        value = self.read_setting(self.setting_key("url"))
        text = value.strip() if isinstance(value, str) else ""
        return text or DEFAULT_URL

    def client(self, timeout: float) -> ActivityWatchClient:
        """
        Client of the configured server

        Args:
            timeout (float): request timeout in seconds
        Returns:
            ActivityWatchClient: client
        Raises:
            ActivityWatchError: invalid URL
        """
        return ActivityWatchClient(validate_url(self.server_url()), self.fetch, timeout)

    def probe(self) -> list[Bucket] | None:
        """
        List the server buckets, cached for PROBE_TTL_SECONDS per URL

        Returns:
            list[Bucket] | None: buckets, None when the server does not answer
        """
        url = self.server_url()
        now = time.monotonic()
        if (
            self._probe
            and self._probe[0] == url
            and now - self._probe[1] < PROBE_TTL_SECONDS
        ):
            return self._probe[2]
        try:
            buckets: list[Bucket] | None = self.client(PROBE_TIMEOUT_SECONDS).buckets()
        except ActivityWatchError as error:
            LOGGER.warning("ActivityWatch probe failed: %s", error)
            buckets = None
        self._probe = (url, now, buckets)
        return buckets

    def is_configured(self) -> bool:
        """
        ActivityWatch only needs a URL, which has a default

        Returns:
            bool: always True (reachability shows in detail)
        """
        return True

    def detail(self) -> str:
        """
        Describe the connection

        Returns:
            str: "N device(s)", or "Not reachable at <url>"
        """
        buckets = self.probe()
        if buckets is None:
            return f"Not reachable at {self.server_url()}"
        count = len(device_names(buckets))
        return f"{count} device{'s' if count != 1 else ''}"

    def content_fields(self) -> list[ContentField]:
        """
        Content an app usage activity can carry

        Returns:
            list[ContentField]: content fields
        """
        return ACTIVITYWATCH_CONTENT

    def config_fields(self) -> list[ConfigField]:
        """
        Declare URL, devices, browser, AFK, short-usage and title settings

        Returns:
            list[ConfigField]: fields
        """
        devices = device_names(self.probe() or [])
        return [
            ConfigField(
                "url",
                "Server URL",
                "ActivityWatch server, as reached from the backend.",
                "text",
                DEFAULT_URL,
            ),
            ConfigField(
                "devices",
                "Only from device",
                "None picked: every device.",
                "multiselect",
                (),
                options_of([(name, name) for name in devices]),
                "All devices",
            ),
            ConfigField(
                "web",
                "Add websites",
                "Needs the aw-watcher-web browser extension.",
                "toggle",
                True,
            ),
            ConfigField(
                "skip_afk",
                "Count only time at the keyboard",
                "Leave out time marked away (AFK).",
                "toggle",
                True,
            ),
            ConfigField(
                "skip_short",
                "Skip usage under 5 minutes per hour",
                "Leave quick app switches out of the summary.",
                "toggle",
                False,
            ),
            ConfigField(
                "share_titles",
                "Share window titles with AI",
                "Off: only app names, domains and durations.",
                "toggle",
                True,
            ),
        ]

    def collect(self, window: TimeRange) -> list[Activity]:
        """
        Read the hourly usage of the window

        Args:
            window (TimeRange): time window
        Returns:
            list[Activity]: one activity per app (or domain) and hour
        Raises:
            SourceUnavailableError: server unreachable or bad answer
        """
        config = self.config()
        slots = time_slots(window.start, window.end, SLOT_LENGTH)
        try:
            client = self.client(QUERY_TIMEOUT_SECONDS)
            tracked = tracked_buckets(client.buckets(), config)
            return [
                item
                for bucket in self.track(tracked, "Querying", "buckets")
                for item in self._bucket_activities(client, bucket, slots, config)
            ]
        except ActivityWatchError as error:
            raise SourceUnavailableError(str(error)) from error

    def _bucket_activities(
        self,
        client: ActivityWatchClient,
        tracked: TrackedBucket,
        slots: Sequence[Slot],
        config: SourceConfig,
    ) -> list[Activity]:
        """
        Query one bucket over every slot and build its activities

        Args:
            client (ActivityWatchClient): server client
            tracked (TrackedBucket): bucket to read
            slots (Sequence[Slot]): hourly slots of the window
            config (SourceConfig): ActivityWatch settings
        Returns:
            list[Activity]: activities of the bucket
        Raises:
            ActivityWatchError: server unreachable or bad answer
        """
        is_web = tracked.kind == WEB_KIND
        lines = usage_query(tracked.bucket.id, tracked.afk_id, is_web)
        key = DOMAIN_KEY if is_web else APP_KEY
        min_seconds = SHORT_SECONDS if config.flag("skip_short") else MIN_SECONDS
        share_titles = config.flag("share_titles")
        return [
            usage_activity(usage, slot[0], tracked, share_titles)
            for slot, events in zip(slots, client.query(slots, lines), strict=True)
            for usage in group_usage(events, key, min_seconds)
        ]

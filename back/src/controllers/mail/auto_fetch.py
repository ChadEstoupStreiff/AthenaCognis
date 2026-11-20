"""Background mail fetch: sync every account at the frequency set in Settings → Mail."""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from controllers.mail import service

ENABLED_KEY = "mail_auto_fetch"
INTERVAL_KEY = "mail_auto_fetch_minutes"
DEFAULT_ENABLED = True
DEFAULT_INTERVAL_MINUTES = 5
MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 1440
SECONDS_PER_MINUTE = 60
CHECK_INTERVAL_SECONDS = 30.0

SettingValue = bool | int | float | str | list[object] | dict[str, object] | None
SettingReader = Callable[[str, SettingValue], SettingValue]
Clock = Callable[[], float]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FetchSchedule:
    """Auto fetch settings."""

    enabled: bool
    interval_seconds: float


def read_interval_minutes(read: SettingReader) -> int:
    """
    Read the fetch frequency, falling back to the default when invalid

    Args:
        read (SettingReader): setting getter (key, default)
    Returns:
        int: minutes between two fetches, clamped to the allowed range
    """
    value = read(INTERVAL_KEY, DEFAULT_INTERVAL_MINUTES)
    if isinstance(value, bool) or not isinstance(value, int | float):
        logger.warning("Invalid %s %r, using %s", INTERVAL_KEY, value, DEFAULT_INTERVAL_MINUTES)
        return DEFAULT_INTERVAL_MINUTES
    return max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, int(value)))


def read_schedule(read: SettingReader) -> FetchSchedule:
    """
    Read the auto fetch settings

    Args:
        read (SettingReader): setting getter (key, default)
    Returns:
        FetchSchedule: whether auto fetch runs and how often
    """
    enabled = read(ENABLED_KEY, DEFAULT_ENABLED)
    return FetchSchedule(
        enabled=enabled if isinstance(enabled, bool) else DEFAULT_ENABLED,
        interval_seconds=read_interval_minutes(read) * SECONDS_PER_MINUTE,
    )


def is_due(schedule: FetchSchedule, last_run: float | None, now: float) -> bool:
    """
    Tell whether a fetch should run now

    Args:
        schedule (FetchSchedule): auto fetch settings
        last_run (float | None): clock time of the last fetch, None = never
        now (float): current clock time
    Returns:
        bool: True when enabled and the interval elapsed since the last fetch
    """
    if not schedule.enabled:
        return False
    return last_run is None or now - last_run >= schedule.interval_seconds


def log_failures(results: list[service.SyncResult]) -> None:
    """
    Log the accounts whose sync failed

    Args:
        results (list[service.SyncResult]): one result per account
    """
    for result in results:
        if result.error:
            logger.warning("Auto fetch of account %s failed: %s", result.account_id, result.error)


class MailAutoFetcher:
    """Daemon thread syncing every account at the configured frequency."""

    thread: threading.Thread | None = None
    last_run: float | None = None

    @classmethod
    def tick(cls, read: SettingReader, clock: Clock = time.monotonic) -> bool:
        """
        Sync every account when a fetch is due

        Args:
            read (SettingReader): setting getter (key, default)
            clock (Clock): monotonic clock
        Returns:
            bool: True when a fetch ran
        """
        if not is_due(read_schedule(read), cls.last_run, clock()):
            return False
        cls.last_run = clock()
        log_failures(service.sync_all())
        return True

    @classmethod
    def start(cls, read: SettingReader) -> None:
        """
        Start the fetcher thread once

        Args:
            read (SettingReader): setting getter (key, default)
        Returns:
            None
        """
        if cls.thread is not None and cls.thread.is_alive():
            return
        cls.thread = threading.Thread(
            target=cls.run, args=(read,), name="mail-auto-fetch", daemon=True
        )
        cls.thread.start()

    @classmethod
    def run(cls, read: SettingReader) -> None:
        """
        Check the schedule forever

        Args:
            read (SettingReader): setting getter (key, default)
        Returns:
            None
        """
        while True:
            try:
                cls.tick(read)
            except Exception:  # keep the thread alive; settings reads raise HTTPException
                logger.exception("Mail auto fetch failed")
            time.sleep(CHECK_INTERVAL_SECONDS)

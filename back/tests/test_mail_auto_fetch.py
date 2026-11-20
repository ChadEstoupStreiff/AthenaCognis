import threading
from collections.abc import Iterator

import pytest

from controllers.mail import auto_fetch, service
from controllers.mail.auto_fetch import FetchSchedule, MailAutoFetcher

FIVE_MINUTES = 300.0

Settings = dict[str, auto_fetch.SettingValue]


def reader(settings: Settings) -> auto_fetch.SettingReader:
    """
    Build a setting getter over a dict

    Args:
        settings (Settings): stored values
    Returns:
        auto_fetch.SettingReader: getter returning the default for missing keys
    """

    def read(key: str, default: auto_fetch.SettingValue) -> auto_fetch.SettingValue:
        """
        Read one setting

        Args:
            key (str): setting key
            default (auto_fetch.SettingValue): fallback
        Returns:
            auto_fetch.SettingValue: stored value or default
        """
        return settings.get(key, default)

    return read


@pytest.fixture(autouse=True)
def reset_fetcher() -> Iterator[None]:
    """
    Forget the last fetch time between tests

    Returns:
        Iterator[None]: test body
    """
    MailAutoFetcher.last_run = None
    yield
    MailAutoFetcher.last_run = None


@pytest.fixture
def sync_calls(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """
    Replace sync_all with a counter

    Args:
        monkeypatch (pytest.MonkeyPatch): patcher
    Returns:
        list[int]: one entry per sync_all call
    """
    calls: list[int] = []

    def fake_sync_all() -> list[service.SyncResult]:
        """
        Record the call

        Returns:
            list[service.SyncResult]: one failed account
        """
        calls.append(1)
        return [service.SyncResult("acc-1", 0, "boom")]

    monkeypatch.setattr(service, "sync_all", fake_sync_all)
    return calls


def test_schedule_defaults() -> None:
    """Missing settings → enabled every 5 minutes."""
    assert auto_fetch.read_schedule(reader({})) == FetchSchedule(True, FIVE_MINUTES)


@pytest.mark.parametrize(
    ("stored", "minutes"),
    [(0, 1), (-3, 1), (99999, 1440), (15, 15), ("abc", 5), (True, 5), (None, 5)],
)
def test_interval_clamped_or_defaulted(stored: auto_fetch.SettingValue, minutes: int) -> None:
    """Out-of-range intervals clamp; non-numbers fall back to the default."""
    settings: Settings = {auto_fetch.INTERVAL_KEY: stored}
    assert auto_fetch.read_interval_minutes(reader(settings)) == minutes


def test_invalid_enabled_falls_back_to_default() -> None:
    """Non-bool toggle → default (enabled)."""
    settings: Settings = {auto_fetch.ENABLED_KEY: "yes"}
    assert auto_fetch.read_schedule(reader(settings)).enabled is True


@pytest.mark.parametrize(
    ("enabled", "last_run", "now", "expected"),
    [
        (False, None, 0.0, False),
        (True, None, 0.0, True),
        (True, 100.0, 100.0 + FIVE_MINUTES - 1, False),
        (True, 100.0, 100.0 + FIVE_MINUTES, True),
    ],
)
def test_is_due(enabled: bool, last_run: float | None, now: float, expected: bool) -> None:
    """Due when enabled and the interval elapsed (or never ran)."""
    schedule = FetchSchedule(enabled, FIVE_MINUTES)
    assert auto_fetch.is_due(schedule, last_run, now) is expected


def test_tick_fetches_then_waits_interval(sync_calls: list[int]) -> None:
    """First tick fetches; next ticks wait for the interval."""
    read = reader({})
    assert MailAutoFetcher.tick(read, clock=lambda: 1000.0)
    assert not MailAutoFetcher.tick(read, clock=lambda: 1000.0 + FIVE_MINUTES - 1)
    assert MailAutoFetcher.tick(read, clock=lambda: 1000.0 + FIVE_MINUTES)
    assert len(sync_calls) == 2


def test_tick_disabled_never_fetches(sync_calls: list[int]) -> None:
    """Toggle off → no fetch."""
    read = reader({auto_fetch.ENABLED_KEY: False})
    assert not MailAutoFetcher.tick(read, clock=lambda: 1000.0)
    assert sync_calls == []


def test_tick_uses_new_frequency(sync_calls: list[int]) -> None:
    """Frequency change applies from the next check."""
    settings: Settings = {auto_fetch.INTERVAL_KEY: 10}
    read = reader(settings)
    assert MailAutoFetcher.tick(read, clock=lambda: 0.0)
    assert not MailAutoFetcher.tick(read, clock=lambda: FIVE_MINUTES)
    settings[auto_fetch.INTERVAL_KEY] = 5
    assert MailAutoFetcher.tick(read, clock=lambda: FIVE_MINUTES)
    assert len(sync_calls) == 2


def test_account_sync_serialized(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two syncs of one account never run at the same time."""
    inside = threading.Event()
    release = threading.Event()
    active: list[int] = []
    overlaps: list[int] = []

    def slow_sync(account_id: str, limit: int) -> service.SyncResult:
        """
        Hold the account while the other thread tries to sync

        Args:
            account_id (str): account id
            limit (int): unused
        Returns:
            service.SyncResult: empty result
        """
        if active:
            overlaps.append(1)
        active.append(1)
        inside.set()
        release.wait(timeout=2)
        active.pop()
        return service.SyncResult(account_id, 0)

    monkeypatch.setattr(service, "_sync_account_locked", slow_sync)
    first = threading.Thread(target=service.sync_account, args=("acc-lock",))
    first.start()
    inside.wait(timeout=2)
    second = threading.Thread(target=service.sync_account, args=("acc-lock",))
    second.start()
    release.set()
    first.join(timeout=2)
    second.join(timeout=2)
    assert overlaps == []

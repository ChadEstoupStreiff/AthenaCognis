from collections.abc import Callable, Mapping
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import views.daily_text
from controllers.daily_text import (
    API_NINJAS_KEY_SETTING,
    BLAGUES_API_KEY_SETTING,
    BLAGUES_API_RANDOM_URL,
    ICANHAZDADJOKE_URL,
    KAAMELOTT_RANDOM_URL,
    PROVIDERS,
    QUOTABLE_RANDOM_URL,
    ZENQUOTES_TODAY_URL,
    DailyText,
    DailyTextCache,
    DailyTextError,
    Fetch,
    JsonValue,
    load_daily_text,
    rotate,
    usable_providers,
)

DAY = date(2026, 11, 26)
NO_KEYS: dict[str, str] = {}
ALL_KEYS = {API_NINJAS_KEY_SETTING: "ninja", BLAGUES_API_KEY_SETTING: "blague"}


def fake_fetch(answers: Mapping[str, JsonValue], calls: list[str]) -> Fetch:
    """
    Build a fetcher answering by URL prefix and failing on unknown URLs

    Args:
        answers (Mapping[str, JsonValue]): JSON by URL prefix
        calls (list[str]): receives every fetched URL
    Returns:
        Fetch: fetcher
    """

    def fetch(url: str, headers: Mapping[str, str], timeout: float) -> JsonValue:
        """
        Answer a URL from the table

        Args:
            url (str): address
            headers (Mapping[str, str]): request headers
            timeout (float): seconds
        Returns:
            JsonValue: canned JSON
        Raises:
            DailyTextError: URL not in the table (offline)
        """
        calls.append(url)
        for prefix, answer in answers.items():
            if url.startswith(prefix):
                return answer
        raise DailyTextError(f"offline: {url}")

    return fetch


def day_starting_with(kind: str, language: str, name: str) -> date:
    """
    Find a day whose rotation starts at a provider (all keys set)

    Args:
        kind (str): kind of text
        language (str): language
        name (str): provider name
    Returns:
        date: first matching day from DAY
    """
    providers = usable_providers(kind, language, ALL_KEYS)  # type: ignore[arg-type]
    names = [provider.name for provider in providers]
    return date.fromordinal(DAY.toordinal() + (names.index(name) - DAY.toordinal()) % len(names))


def test_reads_each_provider_format() -> None:
    """Every provider answer shape becomes a text."""
    cases: list[tuple[str, str, str, dict[str, JsonValue], DailyText]] = [
        ("quote", "en", "ZenQuotes", {ZENQUOTES_TODAY_URL: [{"q": "Be.", "a": "Zen"}]},
         DailyText("Be.", "Zen", "ZenQuotes")),
        ("quote", "en", "Quotable", {QUOTABLE_RANDOM_URL: {"content": "Do.", "author": "Q"}},
         DailyText("Do.", "Q", "Quotable")),
        ("quote", "en", "API Ninjas",
         {"https://api.api-ninjas.com": [{"quote": "Go.", "author": "N"}]},
         DailyText("Go.", "N", "API Ninjas")),
        ("quote", "fr", "Kaamelott",
         {KAAMELOTT_RANDOM_URL: {"citation": {"citation": "C'est pas faux.",
                                              "infos": {"personnage": "Perceval"}}}},
         DailyText("C'est pas faux.", "Perceval, Kaamelott", "Kaamelott")),
        ("joke", "en", "JokeAPI",
         {"https://v2.jokeapi.dev": {"type": "twopart", "setup": "Why?", "delivery": "So."}},
         DailyText("Why?\nSo.", "", "JokeAPI")),
        ("joke", "fr", "JokeAPI",
         {"https://v2.jokeapi.dev": {"type": "single", "joke": "Blague."}},
         DailyText("Blague.", "", "JokeAPI")),
        ("joke", "fr", "Blagues API",
         {BLAGUES_API_RANDOM_URL: {"joke": "Question ?", "answer": "Réponse."}},
         DailyText("Question ?\nRéponse.", "", "Blagues API")),
        ("joke", "en", "icanhazdadjoke", {ICANHAZDADJOKE_URL: {"joke": "Dad."}},
         DailyText("Dad.", "", "icanhazdadjoke")),
    ]
    for kind, language, name, answers, expected in cases:
        day = day_starting_with(kind, language, name)
        text = load_daily_text(kind, language, day, ALL_KEYS, fake_fetch(answers, []))  # type: ignore[arg-type]
        assert text == expected


def test_falls_through_to_next_provider_when_one_fails() -> None:
    """A provider down = next provider answers."""
    day = day_starting_with("joke", "en", "JokeAPI")
    answers = {ICANHAZDADJOKE_URL: {"joke": "Dad."}}
    calls: list[str] = []
    text = load_daily_text("joke", "en", day, NO_KEYS, fake_fetch(answers, calls))
    assert text.provider == "icanhazdadjoke"
    assert len(calls) == 2


def test_jokeapi_error_answer_counts_as_failure() -> None:
    """JokeAPI `error: true` = next provider."""
    day = day_starting_with("joke", "en", "JokeAPI")
    answers: dict[str, JsonValue] = {
        "https://v2.jokeapi.dev": {"error": True, "message": "No matching joke"},
        ICANHAZDADJOKE_URL: {"joke": "Dad."},
    }
    assert load_daily_text("joke", "en", day, NO_KEYS, fake_fetch(answers, [])).text == "Dad."


def test_raises_when_offline() -> None:
    """No provider answers = error."""
    with pytest.raises(DailyTextError):
        load_daily_text("quote", "en", DAY, ALL_KEYS, fake_fetch({}, []))


def test_raises_without_provider() -> None:
    """French motivation has no online source."""
    assert PROVIDERS[("motivation", "fr")] == ()
    with pytest.raises(DailyTextError):
        load_daily_text("motivation", "fr", DAY, ALL_KEYS, fake_fetch({}, []))


def test_skips_providers_without_key() -> None:
    """Keyed providers only when their key is set."""
    names = [provider.name for provider in usable_providers("joke", "fr", NO_KEYS)]
    assert names == ["JokeAPI"]
    names = [provider.name for provider in usable_providers("joke", "fr", ALL_KEYS)]
    assert names == ["JokeAPI", "Blagues API"]


def test_rotation_changes_first_provider_every_day() -> None:
    """Each day starts at the next provider."""
    providers = usable_providers("quote", "en", ALL_KEYS)
    firsts = {rotate(providers, date.fromordinal(DAY.toordinal() + offset))[0].name
              for offset in range(len(providers))}
    assert firsts == {provider.name for provider in providers}
    assert rotate([], DAY) == []


def test_cache_fetches_once_per_day_and_retries_failures() -> None:
    """Success cached for the day; failure retried on next call."""
    cache = DailyTextCache()
    calls: list[str] = []
    with pytest.raises(DailyTextError):
        cache.get("joke", "en", DAY, NO_KEYS, fake_fetch({}, calls))
    online = fake_fetch({ICANHAZDADJOKE_URL: {"joke": "Dad."},
                         "https://v2.jokeapi.dev": {"type": "single", "joke": "Hi."}}, calls)
    first = cache.get("joke", "en", DAY, NO_KEYS, online)
    calls.clear()
    assert cache.get("joke", "en", DAY, NO_KEYS, online) == first
    assert calls == []
    cache.get("joke", "en", date.fromordinal(DAY.toordinal() + 1), NO_KEYS, online)
    assert len(calls) == 1


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """
    Serve the daily text router with a fresh cache and no keys

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        TestClient: test client
    """
    monkeypatch.setattr(views.daily_text, "cache", DailyTextCache())
    monkeypatch.setattr(views.daily_text, "provider_keys", lambda: dict(NO_KEYS))
    app = FastAPI()
    app.include_router(views.daily_text.router)
    return TestClient(app)


def patch_fetch(monkeypatch: pytest.MonkeyPatch, fetch: Fetch) -> None:
    """
    Make the view's cache use a fetcher

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        fetch (Fetch): fetcher
    Returns:
        None
    """
    original: Callable[..., DailyText] = DailyTextCache.get

    def get(self: DailyTextCache, kind: str, language: str, day: date,
            keys: Mapping[str, str], fetch_: Fetch = fetch) -> DailyText:
        """
        Call the real cache with the fake fetcher

        Args:
            self (DailyTextCache): cache
            kind (str): kind
            language (str): language
            day (date): day
            keys (Mapping[str, str]): keys
            fetch_ (Fetch): ignored real fetcher
        Returns:
            DailyText: text
        """
        return original(self, kind, language, day, keys, fetch)

    monkeypatch.setattr(DailyTextCache, "get", get)


def test_endpoint_returns_text(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /daily-text answers text, author, provider."""
    patch_fetch(monkeypatch, fake_fetch({"https://kaamelott.chaudie.re": {
        "citation": {"citation": "Cul.", "infos": {"personnage": "Karadoc"}}}}, []))
    response = client.get("/daily-text", params={"kind": "quote", "language": "fr"})
    assert response.status_code == 200
    assert response.json() == {"text": "Cul.", "author": "Karadoc, Kaamelott",
                               "provider": "Kaamelott"}


def test_endpoint_offline_is_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Offline = 503 so the front shows its offline sentences."""
    patch_fetch(monkeypatch, fake_fetch({}, []))
    response = client.get("/daily-text", params={"kind": "joke", "language": "en"})
    assert response.status_code == 503


def test_endpoint_rejects_unknown_kind(client: TestClient) -> None:
    """Greeting is local to the front; unknown kinds = 422."""
    response = client.get("/daily-text", params={"kind": "greeting", "language": "en"})
    assert response.status_code == 422

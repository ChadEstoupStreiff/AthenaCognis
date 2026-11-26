"""Text of the day shown on Home: quotes, motivation and jokes from online providers."""

import json
import logging
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Literal
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LOGGER = logging.getLogger(__name__)
DailyTextKind = Literal["motivation", "quote", "joke"]
DailyTextLanguage = Literal["fr", "en"]
JsonValue = object
# (url, headers, timeout) -> decoded JSON
Fetch = Callable[[str, Mapping[str, str], float], JsonValue]

# Generic client name, nothing about the user.
USER_AGENT = "AthenaCognis-home"
REQUEST_TIMEOUT_SECONDS = 10.0
API_NINJAS_KEY_SETTING = "api_ninjas_api_key"
BLAGUES_API_KEY_SETTING = "blagues_api_token"

ZENQUOTES_TODAY_URL = "https://zenquotes.io/api/today"
ZENQUOTES_RANDOM_URL = "https://zenquotes.io/api/random"
QUOTABLE_RANDOM_URL = "https://api.quotable.io/random"
API_NINJAS_QUOTES_URL = "https://api.api-ninjas.com/v1/quotes"
API_NINJAS_MOTIVATION_CATEGORY = "inspirational"
KAAMELOTT_RANDOM_URL = "https://kaamelott.chaudie.re/api/random"
JOKEAPI_URL = "https://v2.jokeapi.dev/joke/Any"
BLAGUES_API_RANDOM_URL = "https://www.blagues-api.fr/api/random"
ICANHAZDADJOKE_URL = "https://icanhazdadjoke.com/"


class DailyTextError(RuntimeError):
    """Provider unreachable, key missing or answer not understood."""


@dataclass(frozen=True)
class DailyText:
    """One text of the day."""

    text: str
    author: str
    provider: str


@dataclass(frozen=True)
class Provider:
    """Online source of texts for one kind and language."""

    name: str
    # (fetch, keys) -> text; raises DailyTextError
    load: Callable[[Fetch, Mapping[str, str]], DailyText]
    key_setting: str | None = None


def fetch_json(url: str, headers: Mapping[str, str], timeout: float) -> JsonValue:
    """
    Fetch and decode a JSON document

    Args:
        url (str): address
        headers (Mapping[str, str]): extra request headers
        timeout (float): seconds before giving up
    Returns:
        JsonValue: decoded JSON
    Raises:
        DailyTextError: network error or invalid JSON
    """
    request = Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **headers}
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, ValueError) as error:
        raise DailyTextError(f"{url}: {error}") from error


def field(payload: JsonValue, name: str) -> str:
    """
    Read a non-empty text field of a JSON object

    Args:
        payload (JsonValue): decoded JSON object
        name (str): field name
    Returns:
        str: stripped value
    Raises:
        DailyTextError: not an object, or field missing or empty
    """
    value = payload.get(name) if isinstance(payload, dict) else None
    if not isinstance(value, str) or not value.strip():
        raise DailyTextError(f"Answer has no '{name}' text.")
    return value.strip()


def optional_field(payload: JsonValue, name: str) -> str:
    """
    Read a text field of a JSON object, empty when missing

    Args:
        payload (JsonValue): decoded JSON object
        name (str): field name
    Returns:
        str: stripped value, "" when missing
    """
    try:
        return field(payload, name)
    except DailyTextError:
        return ""


def first_item(payload: JsonValue) -> JsonValue:
    """
    Take the first element of a JSON array

    Args:
        payload (JsonValue): decoded JSON array
    Returns:
        JsonValue: first element
    Raises:
        DailyTextError: not a non-empty array
    """
    if not isinstance(payload, list) or not payload:
        raise DailyTextError("Answer is not a non-empty list.")
    return payload[0]


def two_part(setup: str, punchline: str) -> str:
    """
    Join a joke setup and its punchline

    Args:
        setup (str): question or setup
        punchline (str): answer, may be empty
    Returns:
        str: joke on one or two lines
    """
    return f"{setup}\n{punchline}" if punchline else setup


def zenquotes(url: str, name: str) -> Callable[[Fetch, Mapping[str, str]], DailyText]:
    """
    Build a ZenQuotes loader (`[{"q": text, "a": author}]`)

    Args:
        url (str): endpoint (today or random)
        name (str): provider name
    Returns:
        Callable[[Fetch, Mapping[str, str]], DailyText]: loader
    """

    def load(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
        """
        Load one ZenQuotes quote

        Args:
            fetch (Fetch): JSON fetcher
            keys (Mapping[str, str]): API keys by setting name
        Returns:
            DailyText: quote
        """
        item = first_item(fetch(url, {}, REQUEST_TIMEOUT_SECONDS))
        return DailyText(field(item, "q"), optional_field(item, "a"), name)

    return load


def load_quotable(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
    """
    Load one Quotable quote (`{"content", "author"}`)

    Args:
        fetch (Fetch): JSON fetcher
        keys (Mapping[str, str]): API keys by setting name
    Returns:
        DailyText: quote
    """
    payload = fetch(QUOTABLE_RANDOM_URL, {}, REQUEST_TIMEOUT_SECONDS)
    return DailyText(field(payload, "content"), optional_field(payload, "author"), "Quotable")


def api_ninjas(category: str | None) -> Callable[[Fetch, Mapping[str, str]], DailyText]:
    """
    Build an API Ninjas loader (`[{"quote", "author"}]`, key in `X-Api-Key`)

    Args:
        category (str | None): quote category, None = any
    Returns:
        Callable[[Fetch, Mapping[str, str]], DailyText]: loader
    """
    url = API_NINJAS_QUOTES_URL
    if category is not None:
        url = f"{url}?{urlencode({'category': category})}"

    def load(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
        """
        Load one API Ninjas quote

        Args:
            fetch (Fetch): JSON fetcher
            keys (Mapping[str, str]): API keys by setting name
        Returns:
            DailyText: quote
        """
        headers = {"X-Api-Key": keys[API_NINJAS_KEY_SETTING]}
        item = first_item(fetch(url, headers, REQUEST_TIMEOUT_SECONDS))
        return DailyText(field(item, "quote"), optional_field(item, "author"), "API Ninjas")

    return load


def load_kaamelott(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
    """
    Load one Kaamelott quote (`{"citation": {"citation", "infos": {"personnage"}}}`)

    Args:
        fetch (Fetch): JSON fetcher
        keys (Mapping[str, str]): API keys by setting name
    Returns:
        DailyText: quote, author = character
    """
    payload = fetch(KAAMELOTT_RANDOM_URL, {}, REQUEST_TIMEOUT_SECONDS)
    citation = payload.get("citation") if isinstance(payload, dict) else None
    infos = citation.get("infos") if isinstance(citation, dict) else None
    character = optional_field(infos, "personnage")
    author = f"{character}, Kaamelott" if character else "Kaamelott"
    return DailyText(field(citation, "citation"), author, "Kaamelott")


def jokeapi(language: DailyTextLanguage) -> Callable[[Fetch, Mapping[str, str]], DailyText]:
    """
    Build a JokeAPI loader (single `joke`, or two-part `setup` + `delivery`)

    Args:
        language (DailyTextLanguage): joke language
    Returns:
        Callable[[Fetch, Mapping[str, str]], DailyText]: loader
    """
    url = f"{JOKEAPI_URL}?{urlencode({'lang': language})}&safe-mode"

    def load(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
        """
        Load one JokeAPI joke

        Args:
            fetch (Fetch): JSON fetcher
            keys (Mapping[str, str]): API keys by setting name
        Returns:
            DailyText: joke
        Raises:
            DailyTextError: JokeAPI reported an error
        """
        payload = fetch(url, {}, REQUEST_TIMEOUT_SECONDS)
        if isinstance(payload, dict) and payload.get("error") is True:
            raise DailyTextError(f"JokeAPI: {optional_field(payload, 'message')}")
        if isinstance(payload, dict) and payload.get("type") == "twopart":
            text = two_part(field(payload, "setup"), field(payload, "delivery"))
            return DailyText(text, "", "JokeAPI")
        return DailyText(field(payload, "joke"), "", "JokeAPI")

    return load


def load_blagues_api(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
    """
    Load one Blagues API joke (`{"joke", "answer"}`, token as Bearer)

    Args:
        fetch (Fetch): JSON fetcher
        keys (Mapping[str, str]): API keys by setting name
    Returns:
        DailyText: joke
    """
    headers = {"Authorization": f"Bearer {keys[BLAGUES_API_KEY_SETTING]}"}
    payload = fetch(BLAGUES_API_RANDOM_URL, headers, REQUEST_TIMEOUT_SECONDS)
    text = two_part(field(payload, "joke"), optional_field(payload, "answer"))
    return DailyText(text, "", "Blagues API")


def load_icanhazdadjoke(fetch: Fetch, keys: Mapping[str, str]) -> DailyText:
    """
    Load one icanhazdadjoke joke (`{"joke"}`)

    Args:
        fetch (Fetch): JSON fetcher
        keys (Mapping[str, str]): API keys by setting name
    Returns:
        DailyText: joke
    """
    payload = fetch(ICANHAZDADJOKE_URL, {}, REQUEST_TIMEOUT_SECONDS)
    return DailyText(field(payload, "joke"), "", "icanhazdadjoke")


# Tried in turn, starting at a provider that changes every day.
# No online source of French motivation: Home falls back to its offline sentences.
PROVIDERS: dict[tuple[DailyTextKind, DailyTextLanguage], tuple[Provider, ...]] = {
    ("quote", "en"): (
        Provider("ZenQuotes", zenquotes(ZENQUOTES_TODAY_URL, "ZenQuotes")),
        Provider("Quotable", load_quotable),
        Provider("API Ninjas", api_ninjas(None), API_NINJAS_KEY_SETTING),
    ),
    ("quote", "fr"): (Provider("Kaamelott", load_kaamelott),),
    ("motivation", "en"): (
        Provider("ZenQuotes", zenquotes(ZENQUOTES_RANDOM_URL, "ZenQuotes")),
        Provider(
            "API Ninjas", api_ninjas(API_NINJAS_MOTIVATION_CATEGORY), API_NINJAS_KEY_SETTING
        ),
    ),
    ("motivation", "fr"): (),
    ("joke", "en"): (
        Provider("JokeAPI", jokeapi("en")),
        Provider("icanhazdadjoke", load_icanhazdadjoke),
    ),
    ("joke", "fr"): (
        Provider("JokeAPI", jokeapi("fr")),
        Provider("Blagues API", load_blagues_api, BLAGUES_API_KEY_SETTING),
    ),
}


def usable_providers(
    kind: DailyTextKind, language: DailyTextLanguage, keys: Mapping[str, str]
) -> list[Provider]:
    """
    List the providers of a kind and language whose key, if any, is set

    Args:
        kind (DailyTextKind): kind of text
        language (DailyTextLanguage): language
        keys (Mapping[str, str]): API keys by setting name
    Returns:
        list[Provider]: providers in declaration order
    """
    return [
        provider
        for provider in PROVIDERS[(kind, language)]
        if provider.key_setting is None or keys.get(provider.key_setting, "")
    ]


def rotate(providers: list[Provider], day: date) -> list[Provider]:
    """
    Rotate providers so the first one changes every day

    Args:
        providers (list[Provider]): providers
        day (date): current day
    Returns:
        list[Provider]: same providers, starting at the one of the day
    """
    if not providers:
        return providers
    start = day.toordinal() % len(providers)
    return providers[start:] + providers[:start]


def load_daily_text(
    kind: DailyTextKind,
    language: DailyTextLanguage,
    day: date,
    keys: Mapping[str, str],
    fetch: Fetch = fetch_json,
) -> DailyText:
    """
    Load a text from the first provider that answers

    Args:
        kind (DailyTextKind): kind of text
        language (DailyTextLanguage): language
        day (date): current day, picks the first provider tried
        keys (Mapping[str, str]): API keys by setting name
        fetch (Fetch): JSON fetcher
    Returns:
        DailyText: text
    Raises:
        DailyTextError: no provider, or every provider failed
    """
    providers = rotate(usable_providers(kind, language, keys), day)
    if not providers:
        raise DailyTextError(f"No online provider for {kind} in '{language}'.")
    for provider in providers:
        try:
            return provider.load(fetch, keys)
        except DailyTextError as error:
            LOGGER.warning(f"Daily text: {provider.name} failed: {error}")
    raise DailyTextError(f"Every {kind} provider in '{language}' failed.")


class DailyTextCache:
    """Texts of the current day, fetched once per kind and language."""

    def __init__(self) -> None:
        """
        Start with an empty cache

        Returns:
            None
        """
        self._lock = threading.Lock()
        self._texts: dict[tuple[date, DailyTextKind, DailyTextLanguage], DailyText] = {}

    def get(
        self,
        kind: DailyTextKind,
        language: DailyTextLanguage,
        day: date,
        keys: Mapping[str, str],
        fetch: Fetch = fetch_json,
    ) -> DailyText:
        """
        Return the text of the day, fetching it on first call (failures are not cached)

        Args:
            kind (DailyTextKind): kind of text
            language (DailyTextLanguage): language
            day (date): current day
            keys (Mapping[str, str]): API keys by setting name
            fetch (Fetch): JSON fetcher
        Returns:
            DailyText: text
        Raises:
            DailyTextError: no provider answered
        """
        cache_key = (day, kind, language)
        with self._lock:
            cached = self._texts.get(cache_key)
        if cached is not None:
            return cached
        text = load_daily_text(kind, language, day, keys, fetch)
        with self._lock:
            self._texts = {key: value for key, value in self._texts.items() if key[0] == day}
            return self._texts.setdefault(cache_key, text)

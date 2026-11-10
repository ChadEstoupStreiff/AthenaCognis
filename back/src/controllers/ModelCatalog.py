"""Live model lists of the cloud AI providers, fetched with the stored API keys."""

import logging
from collections.abc import Callable, Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import requests

REQUEST_TIMEOUT_SECONDS = 10
PAGE_SIZE = 1000
ANTHROPIC_VERSION = "2023-06-01"

MISTRAL_URL = "https://api.mistral.ai/v1/models"
OPENAI_URL = "https://api.openai.com/v1/models"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models"
ANTHROPIC_URL = "https://api.anthropic.com/v1/models"
GROQ_URL = "https://api.groq.com/openai/v1/models"
DEEPSEEK_URL = "https://api.deepseek.com/models"

OPENAI_CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt-")
# Not served by /chat/completions, or not text generation
OPENAI_EXCLUDED = (
    "audio",
    "realtime",
    "tts",
    "transcribe",
    "image",
    "search",
    "embedding",
    "instruct",
    "codex",
    "deep-research",
    "computer-use",
    "-pro",
)
OPENAI_VISION = ("gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-5", "o3", "o4")
TRANSCRIPTION_MARKERS = ("whisper", "transcribe")
GEMINI_EXCLUDED = (
    "embedding",
    "tts",
    "image-generation",
    "live",
    "native-audio",
    "aqa",
)
GEMINI_PREFIX = "models/"
# Groq models that are not chat models (speech, safety classifiers)
GROQ_EXCLUDED = ("whisper", "tts", "guard", "orpheus")
GROQ_VISION = ("llama-4", "vision")

Json = Mapping[str, object]
JsonGetter = Callable[[str, Mapping[str, str], Mapping[str, str]], Json]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderCatalog:
    """Models of one provider per task kind, or the reason they are unknown."""

    text: list[str] = field(default_factory=list)
    vision: list[str] = field(default_factory=list)
    transcription: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass(frozen=True)
class ProviderSpec:
    """How to list the models of one provider."""

    key_setting: str
    fetch: Callable[[str, JsonGetter], ProviderCatalog]


def http_get_json(
    url: str, headers: Mapping[str, str], params: Mapping[str, str]
) -> Json:
    """
    GET a JSON object

    Args:
        url (str): URL
        headers (Mapping[str, str]): headers
        params (Mapping[str, str]): query parameters
    Returns:
        Json: body
    Raises:
        requests.RequestException: on network or HTTP failure
        ValueError: when the body is not JSON
        TypeError: when the body is not a JSON object
    """
    response = requests.get(
        url, headers=headers, params=params, timeout=REQUEST_TIMEOUT_SECONDS
    )
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, dict):
        raise TypeError(f"{url} answered no JSON object.")
    return body


def records(body: Json, key: str) -> list[Json]:
    """
    Object items of a list field

    Args:
        body (Json): response
        key (str): list field
    Returns:
        list[Json]: items that are objects
    """
    items = body.get(key)
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def newest_first(items: Iterable[Json], date_key: str) -> list[Json]:
    """
    Sort models newest first (stable for models without date)

    Args:
        items (Iterable[Json]): models
        date_key (str): creation field (number or ISO text)
    Returns:
        list[Json]: sorted models
    """
    return sorted(
        items, key=lambda item: str(item.get(date_key, "")).zfill(32), reverse=True
    )


def unique_ids(items: Iterable[Json], id_key: str = "id") -> list[str]:
    """
    Unique non-empty model ids, order kept

    Args:
        items (Iterable[Json]): models
        id_key (str): id field
    Returns:
        list[str]: ids
    """
    ids = [str(item.get(id_key, "")).strip() for item in items]
    return list(dict.fromkeys(model_id for model_id in ids if model_id))


def bearer(api_key: str) -> dict[str, str]:
    """
    Bearer authorization header

    Args:
        api_key (str): key
    Returns:
        dict[str, str]: headers
    """
    return {"Authorization": f"Bearer {api_key}"}


def capability(item: Json, name: str) -> bool:
    """
    Read a Mistral capability flag

    Args:
        item (Json): model
        name (str): capability
    Returns:
        bool: flag
    """
    capabilities = item.get("capabilities")
    return isinstance(capabilities, dict) and capabilities.get(name) is True


def fetch_mistral(api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    List Mistral chat and vision models

    Args:
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models
    """
    items = newest_first(
        records(get(MISTRAL_URL, bearer(api_key), {}), "data"), "created"
    )
    chat = [item for item in items if capability(item, "completion_chat")]
    return ProviderCatalog(
        text=unique_ids(chat),
        vision=unique_ids(item for item in chat if capability(item, "vision")),
    )


def is_openai_chat(model_id: str) -> bool:
    """
    Check that an OpenAI model works with /chat/completions for text

    Args:
        model_id (str): model id
    Returns:
        bool: chat model
    """
    return model_id.startswith(OPENAI_CHAT_PREFIXES) and not any(
        marker in model_id for marker in OPENAI_EXCLUDED
    )


def fetch_openai(api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    List OpenAI chat, vision and transcription models

    Args:
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models
    """
    ids = unique_ids(
        newest_first(records(get(OPENAI_URL, bearer(api_key), {}), "data"), "created")
    )
    chat = [model_id for model_id in ids if is_openai_chat(model_id)]
    return ProviderCatalog(
        text=chat,
        vision=[
            model_id for model_id in chat if any(m in model_id for m in OPENAI_VISION)
        ],
        transcription=[
            m for m in ids if any(marker in m for marker in TRANSCRIPTION_MARKERS)
        ],
    )


def is_gemini_chat(item: Json) -> bool:
    """
    Check that a Gemini model generates text content

    Args:
        item (Json): model
    Returns:
        bool: text model
    """
    name = str(item.get("name", ""))
    methods = item.get("supportedGenerationMethods")
    return (
        isinstance(methods, list)
        and "generateContent" in methods
        and "gemini" in name
        and not any(marker in name for marker in GEMINI_EXCLUDED)
    )


def fetch_gemini(api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    List Gemini text models (all multimodal)

    Args:
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models
    """
    body = get(GEMINI_URL, {"x-goog-api-key": api_key}, {"pageSize": str(PAGE_SIZE)})
    names = [
        str(item.get("name", "")).removeprefix(GEMINI_PREFIX)
        for item in records(body, "models")
        if is_gemini_chat(item)
    ]
    models = list(dict.fromkeys(name for name in names if name))
    return ProviderCatalog(text=models, vision=models)


def fetch_anthropic(api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    List Claude models (all multimodal, API answers newest first)

    Args:
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models
    """
    headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION}
    models = unique_ids(
        records(get(ANTHROPIC_URL, headers, {"limit": str(PAGE_SIZE)}), "data")
    )
    return ProviderCatalog(text=models, vision=models)


def fetch_groq(api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    List Groq chat, vision and transcription models

    Args:
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models
    """
    ids = sorted(unique_ids(records(get(GROQ_URL, bearer(api_key), {}), "data")))
    chat = [m for m in ids if not any(marker in m for marker in GROQ_EXCLUDED)]
    return ProviderCatalog(
        text=chat,
        vision=[m for m in chat if any(marker in m for marker in GROQ_VISION)],
        transcription=[m for m in ids if "whisper" in m],
    )


def fetch_deepseek(api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    List DeepSeek chat models (text only)

    Args:
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models
    """
    return ProviderCatalog(
        text=unique_ids(records(get(DEEPSEEK_URL, bearer(api_key), {}), "data"))
    )


# Keys are the provider values stored in `<task>_type` settings
PROVIDERS: dict[str, ProviderSpec] = {
    "Mistral": ProviderSpec("mistral_api_key", fetch_mistral),
    "ChatGPT": ProviderSpec("openai_api_key", fetch_openai),
    "openai": ProviderSpec("openai_api_key", fetch_openai),
    "Gemini": ProviderSpec("gemini_api_key", fetch_gemini),
    "Claude": ProviderSpec("anthropic_api_key", fetch_anthropic),
    "DeepSeek": ProviderSpec("deepseek_api_key", fetch_deepseek),
    "groq": ProviderSpec("groq_api_key", fetch_groq),
    "Groq": ProviderSpec("groq_api_key", fetch_groq),
}


def list_one(spec: ProviderSpec, api_key: str, get: JsonGetter) -> ProviderCatalog:
    """
    Model list of one provider

    Args:
        spec (ProviderSpec): provider
        api_key (str): key
        get (JsonGetter): HTTP getter
    Returns:
        ProviderCatalog: models, or the error
    """
    key = api_key.strip()
    if not key:
        return ProviderCatalog(error="No API key")
    try:
        return spec.fetch(key, get)
    except (requests.RequestException, ValueError, TypeError) as error:
        logger.warning("Model list of %s failed: %s", spec.fetch.__name__, error)
        return ProviderCatalog(error=describe_error(error))


def list_all(
    api_keys: Mapping[str, str], get: JsonGetter = http_get_json
) -> dict[str, ProviderCatalog]:
    """
    Model lists of every cloud provider, fetched in parallel (one call per API key)

    Args:
        api_keys (Mapping[str, str]): API key per key setting
        get (JsonGetter): HTTP getter (injected for tests)
    Returns:
        dict[str, ProviderCatalog]: catalog per provider value
    """
    specs = {spec.key_setting: spec for spec in PROVIDERS.values()}
    with ThreadPoolExecutor(max_workers=len(specs)) as pool:
        futures = {
            setting: pool.submit(list_one, spec, api_keys.get(setting, ""), get)
            for setting, spec in specs.items()
        }
        by_setting = {setting: future.result() for setting, future in futures.items()}
    return {
        provider: by_setting[spec.key_setting] for provider, spec in PROVIDERS.items()
    }


def describe_error(error: Exception) -> str:
    """
    Short reason of a failed model list

    Args:
        error (Exception): failure
    Returns:
        str: reason
    """
    if isinstance(error, requests.HTTPError) and error.response is not None:
        status = error.response.status_code
        return (
            "API key rejected"
            if status in (401, 403)
            else f"Provider answered {status}"
        )
    if isinstance(error, requests.Timeout):
        return "Provider timed out"
    if isinstance(error, requests.ConnectionError):
        return "Provider unreachable"
    return "Unexpected answer"

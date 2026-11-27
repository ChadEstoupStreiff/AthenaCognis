import json
from collections.abc import Iterator, Mapping
from types import TracebackType
from typing import Self

import pytest

from controllers.ChatManager import ChatManager
from controllers.ModelCatalog import Json, ProviderCatalog, list_all, list_custom
from tools import ai
from tools.custom_providers import CustomProvider, parse_custom_providers

ALBERT = {
    "id": "custom:albert",
    "name": "Albert",
    "base_url": "https://albert.example/v1/",
    "api_key": "secret",
}


def test_parses_valid_providers_and_drops_the_others() -> None:
    """
    Keep complete http(s) providers only, without trailing slash

    Returns:
        None
    """
    raw = [
        ALBERT,
        {**ALBERT, "api_key": " "},
        {**ALBERT, "base_url": "file:///etc/passwd"},
        {**ALBERT, "id": "ChatGPT"},
        "text",
    ]
    assert parse_custom_providers(raw) == [
        CustomProvider("custom:albert", "Albert", "https://albert.example/v1", "secret")
    ]
    assert parse_custom_providers("") == []


def test_lists_chat_models_of_a_custom_provider() -> None:
    """
    Query `<base>/models` and drop models that cannot chat

    Returns:
        None
    """
    asked: list[str] = []

    def fake_get(
        url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> Json:
        """
        Answer a model list

        Args:
            url (str): URL
            headers (Mapping[str, str]): headers
            params (Mapping[str, str]): query
        Returns:
            Json: body
        """
        asked.append(url)
        return {
            "data": [
                {"id": "vlm", "type": "image-to-text"},
                {"id": "llm", "type": "text-generation"},
                {"id": "untyped"},
                {"id": "embed", "type": "text-embeddings-inference"},
            ]
        }

    catalogs = list_all(
        {}, get=fake_get, custom_providers=parse_custom_providers([ALBERT])
    )
    assert catalogs["custom:albert"].text == ["llm", "untyped", "vlm"]
    assert asked == ["https://albert.example/v1/models"]


def test_resolves_the_endpoint_of_a_custom_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Use the provider URL and key, and fail clearly once removed

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    monkeypatch.setattr(ai, "get_setting", lambda key, default=None: [ALBERT])
    assert ai.openai_endpoint("custom:albert") == ai.Endpoint(
        "Albert", "https://albert.example/v1/chat/completions", "secret"
    )
    assert ai.provider_label("custom:albert") == "Albert"
    assert ai.provider_label("Mistral") == "Mistral"
    with pytest.raises(ai.ProviderNotFoundError, match="no longer exists"):
        ai.openai_endpoint("custom:gone")


class StreamedReply:
    """Streamed chat completion: one text chunk, then chunks without text."""

    status_code = 200
    text = ""

    def __enter__(self) -> Self:
        """
        Enter the context

        Returns:
            StreamedReply: itself
        """
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        """
        Leave the context

        Args:
            kind (type[BaseException] | None): exception type
            value (BaseException | None): exception
            trace (TracebackType | None): traceback
        Returns:
            None
        """

    def iter_lines(self) -> Iterator[bytes]:
        """
        Yield server-sent events

        Returns:
            Iterator[bytes]: lines
        """
        yield f"data: {json.dumps({'choices': [{'delta': {'content': 'Hi'}}]})}".encode()
        yield b'data: {"choices": [{"finish_reason": "stop"}]}'
        yield b'data: {"choices": [], "usage": {"total_tokens": 3}}'
        yield b"data: [DONE]"


def test_chats_through_a_custom_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Send a chat to the provider URL with its key, as plain text

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    settings: dict[str, object] = {
        "chat_type": "custom:albert",
        "chat_model": "albert-large",
        "custom_providers": [ALBERT],
        "chat_llm_timeout_seconds": 5,
        "ai_style_instruction": "",
    }
    sent: dict[str, object] = {}

    def fake_post(
        url: str,
        headers: Mapping[str, str],
        json: Mapping[str, object],
        **kwargs: object,
    ) -> StreamedReply:
        """
        Record the request

        Args:
            url (str): URL
            headers (Mapping[str, str]): headers
            json (Mapping[str, object]): payload
            **kwargs (object): other options
        Returns:
            StreamedReply: answer
        """
        sent.update(url=url, headers=headers, payload=json)
        return StreamedReply()

    monkeypatch.setattr(
        ai, "get_setting", lambda key, default=None: settings.get(key, default)
    )
    monkeypatch.setattr(ai.requests, "post", fake_post)
    messages = [{"role": "user", "content": [{"type": "text", "text": "hello"}]}]
    assert ai.request_chat_llm("chat", messages) == (
        "custom:albert",
        "albert-large",
        "Hi",
    )
    assert sent["url"] == "https://albert.example/v1/chat/completions"
    assert sent["headers"] == {
        "Authorization": "Bearer secret",
        "Content-Type": "application/json",
    }
    assert sent["payload"] == {
        "model": "albert-large",
        "messages": [{"role": "user", "content": "hello"}],
        "stream": True,
    }


def test_chat_explains_a_deleted_provider() -> None:
    """
    Show the reason instead of a generic provider error

    Returns:
        None
    """
    error = ai.ProviderNotFoundError("This AI provider no longer exists.")
    assert ChatManager._sanitize_error(error) == "This AI provider no longer exists."


def models_answer(
    url: str, headers: Mapping[str, str], params: Mapping[str, str]
) -> Json:
    """
    Answer a model list announcing context windows (vLLM and OpenRouter fields)

    Args:
        url (str): URL
        headers (Mapping[str, str]): headers
        params (Mapping[str, str]): query
    Returns:
        Json: body
    """
    return {
        "data": [
            {"id": "albert-large", "max_model_len": 128000},
            {"id": "router-model", "context_length": 32768},
            {"id": "unknown"},
            {"id": "broken", "max_model_len": "big"},
        ]
    }


@pytest.mark.parametrize(
    ("stored", "expected"),
    [(32000, 32000), ("64000", 64000), (0, None), ("big", None), (True, None), (None, None)],
)
def test_parses_the_optional_context_size(stored: object, expected: int | None) -> None:
    """
    Keep a positive typed context size only

    Args:
        stored (object): stored value
        expected (int | None): parsed value
    Returns:
        None
    """
    providers = parse_custom_providers([{**ALBERT, "context_tokens": stored}])
    assert providers[0].context_tokens == expected


def test_lists_the_context_windows_announced_by_the_provider() -> None:
    """
    Read `max_model_len` or `context_length` of each model

    Returns:
        None
    """
    catalogs = list_custom(parse_custom_providers([ALBERT]), get=models_answer)
    assert catalogs["custom:albert"].context_tokens == {
        "albert-large": 128000,
        "router-model": 32768,
    }


def test_lists_custom_providers_only() -> None:
    """
    Ask no built-in provider when only custom lists are wanted

    Returns:
        None
    """
    asked: list[str] = []

    def fake_get(
        url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> Json:
        """
        Record the URL and answer an empty list

        Args:
            url (str): URL
            headers (Mapping[str, str]): headers
            params (Mapping[str, str]): query
        Returns:
            Json: body
        """
        asked.append(url)
        return {"data": []}

    catalogs = list_custom(parse_custom_providers([ALBERT]), get=fake_get)
    assert list(catalogs) == ["custom:albert"]
    assert asked == ["https://albert.example/v1/models"]
    assert list_custom([], get=fake_get) == {}


@pytest.fixture
def albert_settings(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """
    Route settings to a dict holding Albert, and start with an empty context cache

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        dict[str, object]: settings, editable by the test
    """
    settings: dict[str, object] = {"custom_providers": [ALBERT]}
    monkeypatch.setattr(
        ai, "get_setting", lambda key, default=None: settings.get(key, default)
    )
    monkeypatch.setattr(ai, "_custom_context_cache", {})
    return settings


def test_custom_context_uses_the_announced_window_once(
    monkeypatch: pytest.MonkeyPatch, albert_settings: dict[str, object]
) -> None:
    """
    Read the window from `/models`, fetch it once, and fall back for unknown models

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        albert_settings (dict[str, object]): settings
    Returns:
        None
    """
    fetches: list[str] = []

    def fake_list_custom(
        providers: list[CustomProvider],
    ) -> dict[str, ProviderCatalog]:
        """
        Answer the catalog of the asked provider

        Args:
            providers (list[CustomProvider]): providers
        Returns:
            dict[str, ProviderCatalog]: catalogs
        """
        fetches.append(providers[0].id)
        return list_custom(providers, get=models_answer)

    monkeypatch.setattr(ai, "list_custom", fake_list_custom)
    assert ai.get_model_context_tokens("custom:albert", "albert-large") == 128000
    assert ai.get_model_context_tokens("custom:albert", "unknown") == ai.FALLBACK_CONTEXT_TOKENS
    assert fetches == ["custom:albert"]


def test_custom_context_prefers_the_typed_size(
    monkeypatch: pytest.MonkeyPatch, albert_settings: dict[str, object]
) -> None:
    """
    Use the size typed in the provider form without asking the provider

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        albert_settings (dict[str, object]): settings
    Returns:
        None
    """
    albert_settings["custom_providers"] = [{**ALBERT, "context_tokens": 65536}]
    monkeypatch.setattr(ai, "list_custom", pytest.fail)
    assert ai.get_model_context_tokens("custom:albert", "albert-large") == 65536


def test_custom_context_falls_back_when_the_list_fails(
    monkeypatch: pytest.MonkeyPatch, albert_settings: dict[str, object]
) -> None:
    """
    Fall back to the default window, and retry the list on the next request

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        albert_settings (dict[str, object]): settings
    Returns:
        None
    """
    failed = {"custom:albert": ProviderCatalog(error="Provider timed out")}
    monkeypatch.setattr(ai, "list_custom", lambda providers: failed)
    assert ai.get_model_context_tokens("custom:albert", "albert-large") == ai.FALLBACK_CONTEXT_TOKENS
    assert ai._custom_context_cache == {}
    assert ai.get_model_context_tokens("custom:gone", "m") == ai.FALLBACK_CONTEXT_TOKENS


def test_refuses_a_custom_provider_without_model(
    albert_settings: dict[str, object],
) -> None:
    """
    Explain the missing model instead of sending an empty one

    Args:
        albert_settings (dict[str, object]): settings
    Returns:
        None
    """
    albert_settings.update(chat_type="custom:albert", chat_model="")
    messages = [{"role": "user", "content": [{"type": "text", "text": "hello"}]}]
    with pytest.raises(ai.ModelNotSelectedError) as raised:
        ai.request_chat_llm("chat", messages)
    assert ChatManager._sanitize_error(raised.value) == (
        "No model selected for this task. Pick one in AI routing."
    )
    albert_settings["chat_model"] = "albert-large"
    assert ai.read_routing("chat") == ("custom:albert", "albert-large")

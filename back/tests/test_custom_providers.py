import json
from collections.abc import Iterator, Mapping
from types import TracebackType
from typing import Self

import pytest

from controllers.ChatManager import ChatManager
from controllers.ModelCatalog import Json, list_all
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

import json
from collections.abc import Iterator, Mapping
from types import TracebackType
from typing import Self

import pytest

from tools import ai

SETTINGS = {
    "chat_type": "DeepSeek",
    "chat_model": "deepseek-chat",
    "deepseek_api_key": "secret",
    "chat_llm_timeout_seconds": 5,
}


class FakeStream:
    """Streamed chat completion answering two chunks."""

    status_code = 200
    text = ""

    def __enter__(self) -> Self:
        """
        Enter the context

        Returns:
            FakeStream: itself
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
        for text in ("Hel", "lo"):
            yield f"data: {json.dumps({'choices': [{'delta': {'content': text}}]})}".encode()
        yield b"data: [DONE]"


def fake_setting(key: str, default: object = None) -> object:
    """
    Read a test setting

    Args:
        key (str): key
        default (object): fallback
    Returns:
        object: value
    """
    return SETTINGS.get(key, default)


def test_deepseek_chat_sends_plain_text_to_its_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Call the DeepSeek URL with its key and string message contents

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    sent: dict[str, object] = {}

    def fake_post(
        url: str,
        headers: Mapping[str, str],
        json: Mapping[str, object],
        **kwargs: object,
    ) -> FakeStream:
        """
        Record the request

        Args:
            url (str): URL
            headers (Mapping[str, str]): headers
            json (Mapping[str, object]): payload
            **kwargs (object): other options
        Returns:
            FakeStream: answer
        """
        sent.update(url=url, headers=headers, payload=json)
        return FakeStream()

    monkeypatch.setattr(ai, "get_setting", fake_setting)
    monkeypatch.setattr(ai.requests, "post", fake_post)
    messages = [
        {
            "role": "user",
            "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}],
        }
    ]
    assert ai.request_chat_llm("chat", messages)[2] == "Hello"
    assert sent["url"] == "https://api.deepseek.com/chat/completions"
    assert sent["headers"] == {
        "Authorization": "Bearer secret",
        "Content-Type": "application/json",
    }
    payload = sent["payload"]
    assert isinstance(payload, dict)
    assert payload["messages"] == [{"role": "user", "content": "a\nb"}]


def test_deepseek_has_no_vision() -> None:
    """
    Never send images to DeepSeek

    Returns:
        None
    """
    assert not ai.provider_supports_vision("DeepSeek", "deepseek-chat")


def test_groq_chat_uses_its_endpoint_and_keeps_parts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Call the Groq URL with its key and OpenAI-style content parts

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    sent: dict[str, object] = {}

    def fake_post(
        url: str,
        headers: Mapping[str, str],
        json: Mapping[str, object],
        **kwargs: object,
    ) -> FakeStream:
        """
        Record the request

        Args:
            url (str): URL
            headers (Mapping[str, str]): headers
            json (Mapping[str, object]): payload
            **kwargs (object): other options
        Returns:
            FakeStream: answer
        """
        sent.update(url=url, headers=headers, payload=json)
        return FakeStream()

    settings = {**SETTINGS, "chat_type": "Groq", "groq_api_key": "gsk"}
    monkeypatch.setattr(
        ai, "get_setting", lambda key, default=None: settings.get(key, default)
    )
    monkeypatch.setattr(ai.requests, "post", fake_post)
    parts = [{"type": "text", "text": "a"}]
    assert (
        ai.request_chat_llm("chat", [{"role": "user", "content": parts}])[2] == "Hello"
    )
    assert sent["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert sent["headers"] == {
        "Authorization": "Bearer gsk",
        "Content-Type": "application/json",
    }
    payload = sent["payload"]
    assert isinstance(payload, dict)
    assert payload["messages"] == [{"role": "user", "content": parts}]


def test_groq_vision_only_for_multimodal_models() -> None:
    """
    Send images only to Groq's multimodal models

    Returns:
        None
    """
    assert ai.provider_supports_vision(
        "Groq", "meta-llama/llama-4-scout-17b-16e-instruct"
    )
    assert not ai.provider_supports_vision("Groq", "llama-3.3-70b-versatile")

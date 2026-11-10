from collections.abc import Mapping

import pytest
import requests

from controllers.ModelCatalog import (
    ANTHROPIC_URL,
    DEEPSEEK_URL,
    GEMINI_URL,
    GROQ_URL,
    MISTRAL_URL,
    OPENAI_URL,
    Json,
    describe_error,
    list_all,
)

RESPONSES: dict[str, Json] = {
    MISTRAL_URL: {
        "data": [
            {
                "id": "mistral-small",
                "created": 10,
                "capabilities": {"completion_chat": True},
            },
            {
                "id": "pixtral-large",
                "created": 20,
                "capabilities": {"completion_chat": True, "vision": True},
            },
            {
                "id": "mistral-embed",
                "created": 30,
                "capabilities": {"completion_chat": False},
            },
        ]
    },
    OPENAI_URL: {
        "data": [
            {"id": "gpt-4o", "created": 2},
            {"id": "gpt-3.5-turbo", "created": 1},
            {"id": "gpt-4o-realtime-preview", "created": 3},
            {"id": "text-embedding-3-small", "created": 4},
            {"id": "o3-pro", "created": 5},
            {"id": "whisper-1", "created": 0},
            {"id": "gpt-4o-transcribe", "created": 6},
        ]
    },
    GEMINI_URL: {
        "models": [
            {
                "name": "models/gemini-2.5-flash",
                "supportedGenerationMethods": ["generateContent"],
            },
            {
                "name": "models/text-embedding-004",
                "supportedGenerationMethods": ["embedContent"],
            },
            {
                "name": "models/gemini-2.5-flash-preview-tts",
                "supportedGenerationMethods": ["generateContent"],
            },
        ]
    },
    ANTHROPIC_URL: {"data": [{"id": "claude-opus-5-5"}, {"id": "claude-haiku-5-5"}]},
    GROQ_URL: {
        "data": [
            {"id": "whisper-large-v3"},
            {"id": "llama-3.3-70b"},
            {"id": "meta-llama/llama-4-scout"},
            {"id": "meta-llama/llama-guard-4-12b"},
            {"id": "playai-tts"},
        ]
    },
    DEEPSEEK_URL: {"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]},
}

ALL_KEYS = {
    "mistral_api_key": "m",
    "openai_api_key": "o",
    "gemini_api_key": "g",
    "anthropic_api_key": "a",
    "groq_api_key": "q",
    "deepseek_api_key": "d",
}


class FakeHttp:
    """Canned provider answers counting the calls."""

    def __init__(self, failing: str | None = None) -> None:
        """
        Build the fake

        Args:
            failing (str | None): URL answering 401
        Returns:
            None
        """
        self.calls: list[str] = []
        self.failing = failing

    def __call__(
        self, url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> Json:
        """
        Answer a GET

        Args:
            url (str): URL
            headers (Mapping[str, str]): headers
            params (Mapping[str, str]): query
        Returns:
            Json: canned body
        Raises:
            requests.HTTPError: for the failing URL
        """
        self.calls.append(url)
        if url == self.failing:
            response = requests.Response()
            response.status_code = 401
            raise requests.HTTPError(response=response)
        return RESPONSES[url]


def test_lists_models_per_provider_and_kind() -> None:
    """
    Filter each provider's list to usable models, newest first

    Returns:
        None
    """
    catalogs = list_all(ALL_KEYS, get=FakeHttp())
    assert catalogs["Mistral"].text == ["pixtral-large", "mistral-small"]
    assert catalogs["Mistral"].vision == ["pixtral-large"]
    assert catalogs["ChatGPT"].text == ["gpt-4o", "gpt-3.5-turbo"]
    assert catalogs["ChatGPT"].vision == ["gpt-4o"]
    assert catalogs["openai"].transcription == ["gpt-4o-transcribe", "whisper-1"]
    assert catalogs["Gemini"].text == ["gemini-2.5-flash"]
    assert catalogs["Claude"].vision == ["claude-opus-5-5", "claude-haiku-5-5"]
    assert catalogs["groq"].transcription == ["whisper-large-v3"]
    assert catalogs["Groq"].text == ["llama-3.3-70b", "meta-llama/llama-4-scout"]
    assert catalogs["Groq"].vision == ["meta-llama/llama-4-scout"]
    assert catalogs["DeepSeek"].text == ["deepseek-chat", "deepseek-reasoner"]
    assert catalogs["DeepSeek"].vision == []


def test_reports_missing_and_rejected_keys() -> None:
    """
    Return an error instead of models when a key is missing or rejected

    Returns:
        None
    """
    keys = {**ALL_KEYS, "mistral_api_key": " "}
    catalogs = list_all(keys, get=FakeHttp(failing=ANTHROPIC_URL))
    assert catalogs["Mistral"].error == "No API key"
    assert catalogs["Claude"].error == "API key rejected"
    assert catalogs["Claude"].text == []
    assert catalogs["Gemini"].error is None


def test_fetches_each_key_once() -> None:
    """
    Call OpenAI once although two providers use its key

    Returns:
        None
    """
    http = FakeHttp()
    catalogs = list_all({"openai_api_key": "o"}, get=http)
    assert http.calls == [OPENAI_URL]
    assert catalogs["ChatGPT"] == catalogs["openai"]


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (requests.Timeout(), "Provider timed out"),
        (requests.ConnectionError(), "Provider unreachable"),
        (ValueError("bad"), "Unexpected answer"),
    ],
)
def test_describes_errors(error: Exception, message: str) -> None:
    """
    Turn failures into short reasons

    Args:
        error (Exception): failure
        message (str): expected reason
    Returns:
        None
    """
    assert describe_error(error) == message

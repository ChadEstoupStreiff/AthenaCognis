import threading
from collections.abc import Iterator

import pytest
import requests

from tools import token_count


@pytest.fixture(autouse=True)
def fresh_encoder() -> Iterator[None]:
    """
    Forget the cached tokenizer around each test

    Returns:
        Iterator[None]: nothing
    """
    token_count.load_encoder.cache_clear()
    yield
    token_count.load_encoder.cache_clear()


def test_estimates_when_the_download_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Count by length when the tokenizer host is unreachable

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    calls: list[str] = []

    def unreachable(model: str) -> None:
        """
        Fail like a blocked download

        Args:
            model (str): model
        Returns:
            None
        Raises:
            requests.ConnectionError: always
        """
        calls.append(model)
        raise requests.ConnectionError("blocked")

    monkeypatch.setattr(token_count.tiktoken, "encoding_for_model", unreachable)
    assert token_count.count_tokens("a" * 40) == 11
    assert token_count.count_tokens("") == 1
    assert calls == ["gpt-4"]


def test_does_not_wait_for_a_stalled_download(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Give up on a download that never answers

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    release = threading.Event()
    monkeypatch.setattr(token_count, "LOAD_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(
        token_count.tiktoken, "encoding_for_model", lambda model: release.wait()
    )
    assert token_count.count_tokens("abcd") == 2
    release.set()

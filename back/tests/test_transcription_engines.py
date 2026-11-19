from pathlib import Path

import pytest

from controllers import TranscriptionManager as module
from controllers.TranscriptionManager import (
    LOCAL_ENGINES,
    QWEN_ASR_MODELS,
    TranscriptionManager,
)

Calls = list[tuple[Path, tuple[str, ...]]]


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Calls:
    """
    Record local engine runs instead of starting subprocesses

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Calls: (script, arguments) of each run
    """
    recorded: Calls = []

    def run(script: Path, *args: str) -> str:
        """
        Record one run

        Args:
            script (Path): script
            *args (str): arguments
        Returns:
            str: fake transcript
        """
        recorded.append((script, args))
        return "hello"

    monkeypatch.setattr(module, "run_python_script", run)
    return recorded


def use_settings(
    monkeypatch: pytest.MonkeyPatch, provider: str, model: str | None
) -> None:
    """
    Set the transcription provider and model settings

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        provider (str): transcription_type
        model (str | None): transcription_model
    Returns:
        None
    """
    values = {"transcription_type": provider, "transcription_model": model}
    monkeypatch.setattr(
        module, "get_setting", lambda key, default=None: values.get(key, default)
    )


@pytest.mark.parametrize("model", QWEN_ASR_MODELS)
def test_qwen_asr_runs_its_script_with_the_chosen_model(
    monkeypatch: pytest.MonkeyPatch, calls: Calls, model: str
) -> None:
    use_settings(monkeypatch, "qwen_asr", model)
    assert TranscriptionManager.transcribe("/shared/a.mp3") == "hello"
    assert calls == [(LOCAL_ENGINES["qwen_asr"].script, (model, "/shared/a.mp3"))]


def test_qwen_asr_ignores_a_whisper_model_left_in_settings(
    monkeypatch: pytest.MonkeyPatch, calls: Calls
) -> None:
    use_settings(monkeypatch, "qwen_asr", "small")
    TranscriptionManager.transcribe("/shared/a.mp3")
    assert calls[0][1][0] == "Qwen/Qwen3-ASR-0.6B"


def test_whisper_keeps_any_model_name(
    monkeypatch: pytest.MonkeyPatch, calls: Calls
) -> None:
    use_settings(monkeypatch, "local", "large-v3")
    TranscriptionManager.transcribe("/shared/a.mp3")
    assert calls == [(LOCAL_ENGINES["local"].script, ("large-v3", "/shared/a.mp3"))]

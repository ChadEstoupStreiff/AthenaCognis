import pytest

from tools import ai
from tools.style_instruction import Message, apply_to_messages, apply_to_prompt

RULE = "Be brief."


def test_apply_to_prompt_prefixes_or_skips() -> None:
    """
    Prefix the prompt, or leave it when the instruction is empty

    Returns:
        None
    """
    assert apply_to_prompt(RULE, "Summarize") == "Be brief.\n\nSummarize"
    assert apply_to_prompt("  ", "Summarize") == "Summarize"


def test_apply_to_messages_extends_existing_system_message() -> None:
    """
    Append the rule to the system message without mutating the input

    Returns:
        None
    """
    messages: list[Message] = [
        {"role": "system", "content": [{"type": "text", "text": "You are a bot."}]},
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
    ]
    result = apply_to_messages(RULE, messages)
    assert result[0]["content"] == [
        {"type": "text", "text": "You are a bot."},
        {"type": "text", "text": RULE},
    ]
    assert result[1] == messages[1]
    assert messages[0]["content"] == [{"type": "text", "text": "You are a bot."}]


def test_apply_to_messages_creates_system_message_or_skips() -> None:
    """
    Insert a system message when missing; do nothing when disabled

    Returns:
        None
    """
    messages: list[Message] = [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]}
    ]
    assert apply_to_messages(RULE, messages)[0] == {
        "role": "system",
        "content": [{"type": "text", "text": RULE}],
    }
    assert apply_to_messages("", messages) is messages


def test_request_llm_sends_the_instruction(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Prefix every text prompt with the configured instruction

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    settings = {"x_type": "unknown", "x_model": "m", "ai_style_instruction": RULE}
    monkeypatch.setattr(
        ai, "get_setting", lambda key, default=None: settings.get(key, default)
    )
    rules: list[str] = []

    def spy(rule: str, prompt: str) -> str:
        """
        Record the instruction

        Args:
            rule (str): instruction
            prompt (str): prompt
        Returns:
            str: prompt unchanged
        """
        rules.append(rule)
        return prompt

    monkeypatch.setattr(ai, "apply_to_prompt", spy)
    with pytest.raises(ValueError, match="Unsupported AI type"):
        ai.request_llm("x", "Hello")
    assert rules == [RULE]

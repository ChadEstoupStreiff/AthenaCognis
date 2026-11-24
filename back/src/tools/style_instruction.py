"""Answer-style instruction added to every text and chat request (Settings → AI routing)."""

SETTING_KEY = "ai_style_instruction"
DEFAULT_PROMPT_KEY = "style.default_instruction"

Message = dict[str, object]


def apply_to_prompt(instruction: str, prompt: str) -> str:
    """
    Put the style instruction before a single prompt

    Args:
        instruction (str): style instruction, empty to disable
        prompt (str): prompt
    Returns:
        str: prompt with the instruction
    """
    cleaned = instruction.strip()
    return f"{cleaned}\n\n{prompt}" if cleaned else prompt


def apply_to_messages(instruction: str, messages: list[Message]) -> list[Message]:
    """
    Add the style instruction to the system message of a chat (created when missing)

    Args:
        instruction (str): style instruction, empty to disable
        messages (list[Message]): chat messages (`content` = list of parts)
    Returns:
        list[Message]: new message list (input untouched)
    """
    cleaned = instruction.strip()
    if not cleaned:
        return messages
    part = {"type": "text", "text": cleaned}
    first = messages[0] if messages else None
    content = first.get("content") if first is not None else None
    if (
        first is not None
        and first.get("role") == "system"
        and isinstance(content, list)
    ):
        return [{**first, "content": [*content, part]}, *messages[1:]]
    return [{"role": "system", "content": [part]}, *messages]

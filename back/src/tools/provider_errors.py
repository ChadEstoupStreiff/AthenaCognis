"""Readable errors of AI provider HTTP failures (message extracted from the JSON body)."""

import json

MAX_RAW_CHARS = 300
MESSAGE_KEYS = ("message", "detail", "error_description")


class ProviderError(Exception):
    """HTTP failure of an AI provider."""

    def __init__(self, label: str, status_code: int, message: str) -> None:
        """
        Build the error

        Args:
            label (str): provider and call (e.g. "Claude", "Gemini vision")
            status_code (int): HTTP status
            message (str): readable reason
        Returns:
            None
        """
        super().__init__(f"{label} error {status_code}: {message}")
        self.status_code = status_code


def message_of(value: object) -> str | None:
    """
    Find the human message of a JSON error body (nested `error` objects included)

    Args:
        value (object): parsed body or part of it
    Returns:
        str | None: message, or None when absent
    """
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        return next((m for m in map(message_of, value) if m is not None), None)
    if not isinstance(value, dict):
        return None
    for key in MESSAGE_KEYS:
        if isinstance(value.get(key), str) and value[key].strip():
            return str(value[key]).strip()
    return message_of(value.get("error"))


def provider_error(label: str, status_code: int, body: str) -> ProviderError:
    """
    Build a provider error with the message of its body

    Args:
        label (str): provider and call
        status_code (int): HTTP status
        body (str): raw response body
    Returns:
        ProviderError: error to raise
    """
    try:
        message = message_of(json.loads(body))
    except json.JSONDecodeError:
        message = None
    return ProviderError(label, status_code, message or body.strip()[:MAX_RAW_CHARS])

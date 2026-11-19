"""Model configured for mail (Settings → AI routing → Mail)."""

import logging

from controllers.mail.assistant import SETTING_PREFIX
from tools.ai import request_llm
from tools.provider_errors import ProviderError
from views.settings import get_setting

PREVIEW_SETTING_PREFIX = "mail_preview"

logger = logging.getLogger(__name__)


class MailAiError(Exception):
    """The AI provider failed or could not be reached."""


def preview_routing_prefix() -> str:
    """
    Settings prefix of Mail Preview requests (Mail routing until Mail Preview is set)

    Returns:
        str: "mail_preview" when mail_preview_type is set, "mail" otherwise
    """
    return (
        PREVIEW_SETTING_PREFIX
        if get_setting(f"{PREVIEW_SETTING_PREFIX}_type")
        else SETTING_PREFIX
    )


def ask_mail_llm(prompt: str) -> str:
    """
    Send a prompt to the model configured for mail (summaries, briefings, replies)

    Args:
        prompt (str): prompt
    Returns:
        str: answer
    Raises:
        MailAiError: when the provider fails
    """
    return _ask(SETTING_PREFIX, prompt)


def ask_preview_llm(prompt: str) -> str:
    """
    Send a prompt to the model configured for Mail Preview

    Args:
        prompt (str): prompt
    Returns:
        str: answer
    Raises:
        MailAiError: when the provider fails
    """
    return _ask(preview_routing_prefix(), prompt)


def _ask(prefix: str, prompt: str) -> str:
    """
    Send a prompt to the model of a settings prefix

    Args:
        prefix (str): settings prefix (<prefix>_type / <prefix>_model)
        prompt (str): prompt
    Returns:
        str: answer
    Raises:
        MailAiError: when the provider fails
    """
    try:
        _, _, answer = request_llm(setting_prefix=prefix, prompt=prompt)
    except (ProviderError, OSError, ValueError, RuntimeError) as error:
        logger.exception("Mail AI request failed")
        raise MailAiError(f"AI request failed: {error}") from error
    return str(answer)

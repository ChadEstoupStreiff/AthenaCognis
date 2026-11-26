"""User-defined OpenAI-compatible providers, stored in the `custom_providers` setting."""

import logging
from dataclasses import dataclass

SETTING_KEY = "custom_providers"
ID_PREFIX = "custom:"
ALLOWED_SCHEMES = ("http://", "https://")
REQUIRED_FIELDS = ("id", "name", "base_url", "api_key")

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CustomProvider:
    """One OpenAI-compatible provider added by the user."""

    id: str
    name: str
    base_url: str
    api_key: str

    @property
    def chat_url(self) -> str:
        """
        Build the chat completions URL

        Args:
            None
        Returns:
            str: URL
        """
        return f"{self.base_url}/chat/completions"

    @property
    def models_url(self) -> str:
        """
        Build the model list URL

        Args:
            None
        Returns:
            str: URL
        """
        return f"{self.base_url}/models"


def is_custom_provider(provider_id: object) -> bool:
    """
    Tell whether a provider value names a user-defined provider

    Args:
        provider_id (object): value of a `<task>_type` setting
    Returns:
        bool: True for a custom provider
    """
    return isinstance(provider_id, str) and provider_id.startswith(ID_PREFIX)


def parse_provider(entry: object) -> CustomProvider | None:
    """
    Validate one stored provider

    Args:
        entry (object): stored item
    Returns:
        CustomProvider | None: provider, or None when incomplete or invalid
    """
    if not isinstance(entry, dict):
        return None
    values = {name: str(entry.get(name) or "").strip() for name in REQUIRED_FIELDS}
    values["base_url"] = values["base_url"].rstrip("/")
    if not all(values.values()) or not is_custom_provider(values["id"]):
        return None
    if not values["base_url"].lower().startswith(ALLOWED_SCHEMES):
        return None
    return CustomProvider(**values)


def parse_custom_providers(raw: object) -> list[CustomProvider]:
    """
    Read the stored provider list, dropping invalid items

    Args:
        raw (object): value of the `custom_providers` setting
    Returns:
        list[CustomProvider]: valid providers
    """
    if not isinstance(raw, list):
        return []
    parsed = [parse_provider(entry) for entry in raw]
    if None in parsed:
        logger.warning("Ignored %d invalid custom provider(s).", parsed.count(None))
    return [provider for provider in parsed if provider is not None]

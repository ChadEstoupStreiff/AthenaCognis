"""AI routes: live model lists of the cloud providers for the AI routing settings."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from controllers.ModelCatalog import PROVIDERS, ProviderCatalog, list_all, list_custom
from tools.custom_providers import SETTING_KEY, parse_custom_providers
from views.settings import get_setting

router = APIRouter(prefix="/ai", tags=["AI"])


class ProviderModels(BaseModel):
    """Models of one provider per task kind; error set when the list is unknown."""

    text: list[str]
    vision: list[str]
    transcription: list[str]
    context_tokens: dict[str, int]
    error: str | None


def to_response(provider_catalog: ProviderCatalog) -> ProviderModels:
    """
    Convert a catalog into its API model

    Args:
        provider_catalog (ProviderCatalog): catalog
    Returns:
        ProviderModels: API model
    """
    return ProviderModels(
        text=provider_catalog.text,
        vision=provider_catalog.vision,
        transcription=provider_catalog.transcription,
        context_tokens=provider_catalog.context_tokens,
        error=provider_catalog.error,
    )


@router.get("/models")
def list_models(scope: Literal["all", "custom"] = "all") -> dict[str, ProviderModels]:
    """
    List the models available to the stored API keys (asked live to each provider)

    Args:
        scope (Literal["all", "custom"]): "custom" asks the user-defined providers only
    Returns:
        dict[str, ProviderModels]: models per provider value (`<task>_type` setting)
    """
    custom_providers = parse_custom_providers(get_setting(SETTING_KEY, []))
    if scope == "custom":
        catalogs = list_custom(custom_providers)
    else:
        key_settings = {spec.key_setting for spec in PROVIDERS.values()}
        api_keys = {key: str(get_setting(key) or "") for key in key_settings}
        catalogs = list_all(api_keys, custom_providers=custom_providers)
    return {
        provider: to_response(provider_catalog)
        for provider, provider_catalog in catalogs.items()
    }

"""AI routes: live model lists of the cloud providers for the AI routing settings."""

from fastapi import APIRouter
from pydantic import BaseModel

from controllers.ModelCatalog import PROVIDERS, ProviderCatalog, list_all
from views.settings import get_setting

router = APIRouter(prefix="/ai", tags=["AI"])


class ProviderModels(BaseModel):
    """Models of one provider per task kind; error set when the list is unknown."""

    text: list[str]
    vision: list[str]
    transcription: list[str]
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
        error=provider_catalog.error,
    )


@router.get("/models")
def list_models() -> dict[str, ProviderModels]:
    """
    List the models available to the stored API keys (asked live to each provider)

    Returns:
        dict[str, ProviderModels]: models per provider value (`<task>_type` setting)
    """
    key_settings = {spec.key_setting for spec in PROVIDERS.values()}
    api_keys = {key: str(get_setting(key) or "") for key in key_settings}
    return {
        provider: to_response(provider_catalog)
        for provider, provider_catalog in list_all(api_keys).items()
    }

from dataclasses import asdict
from datetime import date

from fastapi import APIRouter, HTTPException

from controllers.daily_text import (
    API_NINJAS_KEY_SETTING,
    BLAGUES_API_KEY_SETTING,
    DailyTextCache,
    DailyTextError,
    DailyTextKind,
    DailyTextLanguage,
)
from views.settings import get_setting

HTTP_SERVICE_UNAVAILABLE = 503
KEY_SETTINGS = (API_NINJAS_KEY_SETTING, BLAGUES_API_KEY_SETTING)

router = APIRouter(prefix="/daily-text", tags=["Home"])
cache = DailyTextCache()


def provider_keys() -> dict[str, str]:
    """
    Read the daily text API keys from the settings

    Returns:
        dict[str, str]: key by setting name, "" when unset
    """
    return {name: str(get_setting(name) or "").strip() for name in KEY_SETTINGS}


@router.get("")
def get_daily_text(kind: DailyTextKind, language: DailyTextLanguage) -> dict[str, str]:
    """
    Return the text of the day from an online provider (sync: runs in the thread pool)

    Args:
        kind (DailyTextKind): motivation | quote | joke
        language (DailyTextLanguage): fr | en
    Returns:
        dict[str, str]: text, author ("" when none) and provider name
    Raises:
        HTTPException: 503 when no provider answered (offline, no provider, keys rejected)
    """
    try:
        text = cache.get(kind, language, date.today(), provider_keys())
    except DailyTextError as error:
        raise HTTPException(status_code=HTTP_SERVICE_UNAVAILABLE, detail=str(error)) from error
    return asdict(text)

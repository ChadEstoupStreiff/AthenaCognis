"""Usage route: anonymous counters sent by the front with the opt-in telemetry ping."""

import logging
from dataclasses import asdict
from typing import Dict

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from controllers.UsageStats import collect_usage
from db import get_db

router = APIRouter(prefix="/usage", tags=["Usage"])

logger = logging.getLogger(__name__)


@router.get("")
def usage() -> Dict[str, int]:
    """
    Return feature usage counters (numbers only, no names or content)

    Returns:
        Dict[str, int]: counters
    Raises:
        HTTPException: when the database cannot be read
    """
    db = get_db()
    try:
        return asdict(collect_usage(db))
    except SQLAlchemyError as error:
        logger.exception("Usage counters failed")
        raise HTTPException(
            status_code=500, detail="Usage counters unavailable"
        ) from error
    finally:
        db.close()

from dataclasses import asdict

from fastapi import APIRouter

from controllers.update_check import UPDATE_CHECKER

router = APIRouter(prefix="/update", tags=["Update"])


@router.get("/status")
def update_status(force: bool = False) -> dict[str, object]:
    """
    Tell whether GitHub has commits the installed version lacks

    Args:
        force (bool): skip the 10-minute cache
    Returns:
        dict[str, object]: state, behind_by, local_commit, reason, checked_at
    """
    return asdict(UPDATE_CHECKER.status(force))

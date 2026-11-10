"""Research routes: server-side PDF download for the paper search."""

import logging

from fastapi import APIRouter, HTTPException
from starlette.responses import Response

from controllers.PaperFetcher import FetchError, fetch_pdf

router = APIRouter(prefix="/research", tags=["Research"])

logger = logging.getLogger(__name__)


@router.get("/fetch")
def fetch_paper(url: str) -> Response:
    """
    Download the PDF of a paper found online (the front then uploads it)

    Args:
        url (str): PDF or landing page URL
    Returns:
        Response: PDF bytes
    Raises:
        HTTPException: when no PDF can be downloaded
    """
    try:
        content = fetch_pdf(url)
    except FetchError as error:
        logger.warning("Paper fetch failed for %s: %s", url, error)
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    return Response(content, media_type="application/pdf")

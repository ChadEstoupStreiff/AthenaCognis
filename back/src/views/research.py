"""Research routes: server-side PDF download and AI query writing for the paper search."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette.responses import Response

from controllers.PaperFetcher import FetchError, fetch_pdf
from controllers.PaperQueryWriter import (
    MAX_CONTEXT_CHARS,
    SETTING_PREFIX,
    ContextKind,
    QueryError,
    write_queries,
)
from tools.ai import request_llm

HTTP_BAD_GATEWAY = 502
HTTP_UNPROCESSABLE = 422

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


class AiQueriesRequest(BaseModel):
    """What the AI search is based on."""

    context: str = Field(min_length=1, max_length=MAX_CONTEXT_CHARS * 2)
    kind: ContextKind


class AiQueriesResponse(BaseModel):
    """OpenAlex queries written by the AI."""

    queries: list[str]


def ask_research_llm(prompt: str) -> str:
    """
    Send a prompt to the model configured for the paper search

    Args:
        prompt (str): prompt
    Returns:
        str: answer
    """
    return str(request_llm(setting_prefix=SETTING_PREFIX, prompt=prompt)[2])


@router.post("/ai-queries")
def ai_queries(body: AiQueriesRequest) -> AiQueriesResponse:
    """
    Ask the paper-search AI for OpenAlex queries (the front runs them)

    Args:
        body (AiQueriesRequest): description or paper list
    Returns:
        AiQueriesResponse: queries
    Raises:
        HTTPException: when the AI fails or writes no usable query
    """
    try:
        return AiQueriesResponse(
            queries=write_queries(body.context, body.kind, ask_research_llm)
        )
    except QueryError as error:
        raise HTTPException(
            status_code=HTTP_UNPROCESSABLE, detail=str(error)
        ) from error
    except Exception as error:
        logger.exception("AI paper search failed")
        raise HTTPException(
            status_code=HTTP_BAD_GATEWAY, detail=f"AI request failed: {error}"
        ) from error

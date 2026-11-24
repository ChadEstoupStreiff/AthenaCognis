import logging
import traceback

from fastapi import APIRouter, HTTPException
from tools.ai import request_llm
from tools.prompts import get_prompt, render

router = APIRouter(prefix="/utils", tags=["Utils"])


@router.get("/ai/refractor")
async def refractor_text(text: str, question: str = None):
    """
    Refractor the input text using the configured AI model.
    """
    try:
        return request_llm(
            setting_prefix="refractor",
            prompt=render(
                "refractor.rewrite",
                question=question or get_prompt("refractor.default_question"),
                text=text,
            ),
        )[2]  # Return only the response part
    except Exception as e:
        logging.error(f"Error refractoring text: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error refractoring text: {str(e)}"
        )

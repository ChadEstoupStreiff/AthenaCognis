import logging
import traceback

from fastapi import APIRouter, HTTPException
from tools.ai import request_llm

router = APIRouter(prefix="/utils", tags=["Utils"])


@router.get("/ai/refractor")
async def refractor_text(text: str, question: str = None):
    """
    Refractor the input text using the configured AI model.
    """
    try:
        return request_llm(
            setting_prefix="refractor",
            prompt=f"""Respond ONLY with the text in the LANGUAGE of the text. {question if question else "Improve this text:"}\n\n{text}""",
        )[2]  # Return only the response part
    except Exception as e:
        logging.error(f"Error refractoring text: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error refractoring text: {str(e)}"
        )

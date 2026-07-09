import json
import logging
import re
import traceback
from typing import List, Optional

from controllers.LinkManager import LinkManager
from controllers.SummarizeManager import SummarizeManager
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tools.ai import request_llm

router = APIRouter(prefix="/links", tags=["Link"])


@router.get("/list/{file:path}")
def list_links(file: str):
    return LinkManager.list_links(file)

@router.post("/add")
def add_link(
    fileA: str,
    fileB: str,
    force: Optional[float] = 1.0,
    comment: Optional[str] = None,
):
    LinkManager.add_link(fileA, fileB, force, comment)
    return {"status": "success"}

@router.delete("/remove")
def remove_link(fileA: str, fileB: str):
    LinkManager.remove_link(fileA, fileB)
    return {"status": "success"}


class AutoFindRequest(BaseModel):
    source_file: str
    target_files: List[str]


@router.post("/auto-find")
def auto_find_links(request: AutoFindRequest):
    """
    Use AI to find semantic links between the source file and each target file.
    Returns a list of suggested links: [{fileA, fileB, force, comment}].
    All returned links always involve source_file as one endpoint.
    """
    source = request.source_file
    targets = request.target_files
    if not targets:
        raise HTTPException(status_code=400, detail="At least 1 target file is required.")

    def describe_file(path: str) -> str:
        summary_data = SummarizeManager.get(path)
        name = path.split("/")[-1]
        if summary_data and summary_data.get("summary"):
            keywords = ", ".join(summary_data.get("keywords", []))
            return f"File: {name}\nPath: {path}\nSummary: {summary_data['summary']}\nKeywords: {keywords}"
        return f"File: {name}\nPath: {path}\n(No summary available)"

    source_desc = describe_file(source)
    targets_block = "\n\n".join(f"- {describe_file(t)}" for t in targets)

    prompt = f"""You are a document analysis assistant. Assess how semantically related each target file is to the source file.

Source file:
{source_desc}

Target files:
{targets_block}

For each target file that has a genuine semantic relationship with the source file, output one JSON object.
Score force based on the strength of the relationship (shared topic, methodology, data, citations, etc.).
Include all targets, even if the relationship is weak or nonexistent (force=0). If no relationship, set force to 0 and comment to "No relation".

Rules:
- Set "force" between 0 (weak) and 3.0 (strong).
- Write a short "comment" explaining the link (max 20 words).
- Always use "{source}" as "fileA" and the target path as "fileB".
- Output ONLY a valid JSON array, no explanation, no markdown, no code block.

Output format:
[
  {{"fileA": "{source}", "fileB": "<target_path>", "force": <float>, "comment": "<short explanation>"}},
  ...
]

If no target files are related to the source file, output an empty array: []"""

    try:
        _, _, raw = request_llm("link", prompt)
    except Exception as e:
        logging.error(f"LLM error in auto-find links: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    try:
        raw = raw.strip()
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            raw = match.group(0)
        links = json.loads(raw)
        result = []
        valid_targets = set(targets)
        for link in links:
            fa = link.get("fileA", "")
            fb = link.get("fileB", "")
            # Normalize so source is always fileA
            if fa == source and fb in valid_targets:
                pass
            elif fb == source and fa in valid_targets:
                fa, fb = fb, fa
            else:
                continue
            force = float(link.get("force", 1.0))
            force = max(0.0, min(3.0, force))
            comment = str(link.get("comment", ""))[:200]
            result.append({"fileA": fa, "fileB": fb, "force": force, "comment": comment})
        return result
    except Exception as e:
        logging.error(f"Failed to parse AI link response: {str(e)}\nRaw: {raw}")
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")

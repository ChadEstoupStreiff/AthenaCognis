"""AI paper search: ask the configured LLM for OpenAlex search queries."""

import json
import logging
import re
from collections.abc import Callable
from typing import Literal

SETTING_PREFIX = "research"
MAX_CONTEXT_CHARS = 12_000
MAX_QUERIES = 6
MAX_QUERY_CHARS = 400
JSON_ARRAY = re.compile(r"\[.*\]", re.DOTALL)

ContextKind = Literal["description", "papers"]
LlmCall = Callable[[str], str]

CONTEXT_INTROS = {
    "description": "The researcher describes their research as follows:",
    "papers": "The researcher's library contains these papers (title, year):",
}

PROMPT = """You help a researcher find recently published scientific papers.
{intro}

<context>
{context}
</context>

Write between 3 and {max_queries} search queries for the OpenAlex full-text search
(it matches words in titles, abstracts and full texts). Each query covers one distinct
angle of the research. Query syntax:
- "exact phrase" in double quotes
- OR between synonyms, AND between the 2-3 concepts that must all appear, NOT to exclude
- parentheses to group, operators in UPPERCASE, no wildcards
Keep each query focused: too broad floods the results, too many AND finds nothing.

Answer ONLY with a JSON array of strings, no explanation. Example:
["(\\"large language model\\" OR LLM) AND (retrieval OR RAG)", "\\"protein folding\\" AND \\"deep learning\\""]"""

logger = logging.getLogger(__name__)


class QueryError(Exception):
    """The LLM gave no usable query."""


def build_prompt(context: str, kind: ContextKind) -> str:
    """
    Build the query-writing prompt

    Args:
        context (str): description or paper list
        kind (ContextKind): what the context is
    Returns:
        str: prompt
    """
    return PROMPT.format(
        intro=CONTEXT_INTROS[kind],
        context=context.strip()[:MAX_CONTEXT_CHARS],
        max_queries=MAX_QUERIES,
    )


def parse_queries(answer: str) -> list[str]:
    """
    Extract the queries of an LLM answer (first JSON array of strings)

    Args:
        answer (str): raw LLM answer
    Returns:
        list[str]: unique non-empty queries, at most MAX_QUERIES
    Raises:
        QueryError: when the answer holds no JSON array of strings
    """
    match = JSON_ARRAY.search(answer)
    if match is None:
        raise QueryError("The AI answer holds no query list.")
    try:
        values = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise QueryError("The AI answer is not valid JSON.") from error
    if not isinstance(values, list):
        raise QueryError("The AI answer is not a list.")
    queries = [
        " ".join(value.split())[:MAX_QUERY_CHARS]
        for value in values
        if isinstance(value, str) and value.strip()
    ]
    unique = list(dict.fromkeys(queries))[:MAX_QUERIES]
    if not unique:
        raise QueryError("The AI wrote no query.")
    return unique


def write_queries(context: str, kind: ContextKind, llm: LlmCall) -> list[str]:
    """
    Ask the LLM for OpenAlex queries matching a research context

    Args:
        context (str): description or paper list
        kind (ContextKind): what the context is
        llm (LlmCall): prompt → answer
    Returns:
        list[str]: queries
    Raises:
        QueryError: when the context is empty or the answer unusable
    """
    if not context.strip():
        raise QueryError("Nothing to base the AI search on.")
    answer = llm(build_prompt(context, kind))
    logger.info("AI paper search answer: %s", answer)
    return parse_queries(answer)

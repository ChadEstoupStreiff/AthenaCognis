from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from controllers.PaperQueryWriter import (
    MAX_CONTEXT_CHARS,
    MAX_QUERIES,
    QueryError,
    build_prompt,
    parse_queries,
    write_queries,
)


def test_parse_queries_reads_array_inside_chatter() -> None:
    """
    Extract the JSON array even when the model adds text around it

    Returns:
        None
    """
    answer = 'Sure:\n```json\n["(\\"MRI\\" OR \\"magnetic resonance\\") AND histology", "x"]\n```'
    assert parse_queries(answer) == [
        '("MRI" OR "magnetic resonance") AND histology',
        "x",
    ]


def test_parse_queries_cleans_dedupes_and_caps() -> None:
    """
    Collapse whitespace, drop blanks and non-strings, remove duplicates, cap the count

    Returns:
        None
    """
    values = ["a  b", "a b", "", 3, *[f"q{index}" for index in range(10)]]
    answer = str(values).replace("'", '"')
    queries = parse_queries(answer)
    assert queries[0] == "a b"
    assert len(queries) == MAX_QUERIES
    assert queries.count("a b") == 1


@pytest.mark.parametrize(
    "answer", ["no list here", "[not json", '["", "  "]', "[1, 2]"]
)
def test_parse_queries_rejects_unusable_answers(answer: str) -> None:
    """
    Fail with QueryError when no usable query is found

    Args:
        answer (str): LLM answer
    Returns:
        None
    """
    with pytest.raises(QueryError):
        parse_queries(answer)


def test_build_prompt_truncates_context_and_names_kind() -> None:
    """
    Keep the context under the limit and introduce it by kind

    Returns:
        None
    """
    prompt = build_prompt("x" * (MAX_CONTEXT_CHARS + 50), "papers")
    assert "library contains these papers" in prompt
    assert "x" * (MAX_CONTEXT_CHARS + 1) not in prompt


def test_write_queries_calls_llm_with_prompt() -> None:
    """
    Send the built prompt to the LLM and parse its answer

    Returns:
        None
    """
    prompts: list[str] = []

    def fake_llm(prompt: str) -> str:
        """
        Record the prompt and answer two queries

        Args:
            prompt (str): prompt
        Returns:
            str: answer
        """
        prompts.append(prompt)
        return '["a", "b"]'

    assert write_queries("ex vivo MRI", "description", fake_llm) == ["a", "b"]
    assert "ex vivo MRI" in prompts[0]


def test_write_queries_rejects_empty_context() -> None:
    """
    Refuse to call the LLM without context

    Returns:
        None
    """
    with pytest.raises(QueryError):
        write_queries("   ", "description", lambda prompt: "[]")


def ai_queries_client(
    monkeypatch: pytest.MonkeyPatch, answer: Callable[[str], str]
) -> TestClient:
    """
    Build a client of the research routes with a stubbed LLM

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        answer (Callable[[str], str]): fake LLM
    Returns:
        TestClient: client
    """
    from views import research

    monkeypatch.setattr(research, "ask_research_llm", answer)
    app = FastAPI()
    app.include_router(research.router)
    return TestClient(app)


def test_ai_queries_route_returns_queries(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Answer the parsed queries of the LLM

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    client = ai_queries_client(monkeypatch, lambda prompt: '["a", "b"]')
    response = client.post(
        "/research/ai-queries", json={"context": "MRI", "kind": "description"}
    )
    assert response.status_code == 200
    assert response.json() == {"queries": ["a", "b"]}


def test_ai_queries_route_maps_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Answer 422 for unusable answers and 502 for LLM failures

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    body = {"context": "MRI", "kind": "papers"}
    unusable = ai_queries_client(monkeypatch, lambda prompt: "no idea")
    assert unusable.post("/research/ai-queries", json=body).status_code == 422

    def broken(prompt: str) -> str:
        """
        Fail like an unreachable provider

        Args:
            prompt (str): prompt
        Returns:
            str: never
        Raises:
            ConnectionError: always
        """
        raise ConnectionError("down")

    failing = ai_queries_client(monkeypatch, broken)
    response = failing.post("/research/ai-queries", json=body)
    assert response.status_code == 502
    assert "down" in response.json()["detail"]

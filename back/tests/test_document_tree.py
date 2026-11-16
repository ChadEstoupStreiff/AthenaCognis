import json
import re
from typing import List, Optional, Tuple

import pytest
from conftest import SessionFactory

from controllers.DocumentTreeManager import (
    MAX_BLOCK_CHARS,
    DocumentTreeManager,
    SectionDraft,
    TreeInputError,
    TreeParams,
    TreeParamsError,
    build_prompt,
    extract_json_array,
    normalize_sections,
    range_ends,
    routing_prefix,
    split_blocks,
)
from db.models import DocumentTree, TaskStateEnum

PAPER = "/shared/2026-11-16/uploads/paper.pdf"
RANGE_PATTERN = re.compile(r"blocks (\d+) to (\d+)")
PARAGRAPH_WORDS = 40
PARAGRAPH_COUNT = 8


def make_paper(paragraphs: int = PARAGRAPH_COUNT) -> str:
    """
    Build a fake document of numbered paragraphs

    Args:
        paragraphs (int): number of paragraphs
    Returns:
        str: text with blank-line separated paragraphs
    """
    return "\n\n".join(
        " ".join([f"p{index}"] * PARAGRAPH_WORDS) for index in range(1, paragraphs + 1)
    )


def halving_llm(setting_prefix: str, prompt: str, input_text: Optional[str] = None) -> Tuple[str, str, str]:
    """
    Pretend to be the LLM: split the asked range in two halves

    Args:
        setting_prefix (str): settings prefix
        prompt (str): prompt with the range
        input_text (Optional[str]): numbered blocks
    Returns:
        Tuple[str, str, str]: AI type, model and JSON answer
    """
    match = RANGE_PATTERN.search(prompt)
    assert match is not None
    start, end = int(match.group(1)), int(match.group(2))
    middle = (start + end + 1) // 2
    answer = [
        {"title": f"A{start}", "description": "first half", "start": start, "end": middle - 1},
        {"title": f"B{middle}", "description": "second half", "start": middle, "end": end},
    ]
    return "fake", "fake", f"```json\n{json.dumps(answer)}\n```"


@pytest.fixture
def paper(monkeypatch: pytest.MonkeyPatch) -> str:
    """
    Serve a fake document and a fake LLM to the tree manager

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        str: document text
    """
    text = make_paper()
    monkeypatch.setattr("controllers.DocumentTreeManager.read_text", lambda file: text)
    monkeypatch.setattr("controllers.DocumentTreeManager.request_llm", halving_llm)
    monkeypatch.setattr("controllers.DocumentTreeManager.get_setting", lambda key: None)
    return text


def test_split_blocks_keeps_paragraphs() -> None:
    """
    Check paragraphs separated by blank lines become blocks

    Returns:
        None
    """
    assert split_blocks("one\n\n  \n\ntwo\nlines\n\n") == ["one", "two\nlines"]


def test_split_blocks_packs_long_paragraph_and_cuts_before_headings() -> None:
    """
    Check a blank-line-free PDF text is cut by size and before headings

    Returns:
        None
    """
    line = "x" * 100
    body = "\n".join([line] * 25)
    blocks = split_blocks(f"{body}\n2.1 Methods\n{line}")
    assert all(len(block) <= MAX_BLOCK_CHARS for block in blocks[:-1])
    assert blocks[-1].startswith("2.1 Methods")


def test_extract_json_array_tolerates_fence_and_text() -> None:
    """
    Check a fenced answer with chatter still parses

    Returns:
        None
    """
    assert extract_json_array('Sure:\n```json\n[{"start": 1}]\n```') == [{"start": 1}]
    with pytest.raises(ValueError):
        extract_json_array("no json here")


def test_normalize_sections_covers_range_without_overlap() -> None:
    """
    Check messy starts become ordered, clamped, distinct and gap-free

    Returns:
        None
    """
    items: List[object] = [
        {"title": "C", "start": 9},
        {"title": "A", "start": 2},
        {"title": "dup", "start": 9},
        {"title": "B", "start": "5"},
        {"title": "bad"},
        "garbage",
    ]
    drafts = normalize_sections(items, 3, 7)
    assert [(draft.title, draft.start) for draft in drafts] == [("A", 3), ("B", 5), ("C", 7)]
    assert range_ends(drafts, 7) == [4, 6, 7]


def test_range_ends_single_section() -> None:
    """
    Check a single draft spans to the range end

    Returns:
        None
    """
    assert range_ends([SectionDraft("only", "", 4)], 9) == [9]


def test_params_bounds() -> None:
    """
    Check out-of-bound parameters are rejected

    Returns:
        None
    """
    with pytest.raises(TreeParamsError):
        TreeParams(max_depth=0)
    with pytest.raises(TreeParamsError):
        TreeParams(max_sections=20)
    with pytest.raises(TreeParamsError):
        TreeParams(focus="x" * 1000)


def test_tree_job_stores_nested_json(session_factory: SessionFactory, paper: str) -> None:
    """
    Check the job builds a nested tree with ids and ranges, honoring max_depth

    Args:
        session_factory (SessionFactory): fixture
        paper (str): fixture
    Returns:
        None
    """
    DocumentTreeManager.request(PAPER, TreeParams(max_depth=2, min_words=50, auto_depth=False))
    DocumentTreeManager.process_next()

    assert DocumentTreeManager.latest_state(PAPER) == TaskStateEnum.COMPLETED
    record = DocumentTreeManager.get(PAPER)
    assert record is not None
    assert record["block_count"] == PARAGRAPH_COUNT
    assert record["params"]["max_depth"] == 2
    first, second = record["tree"]
    assert first["section_id"] == "1"
    assert first["Title"] == "A1"
    assert first["paper_section_range"] == [1, 4]
    assert second["paper_section_range"] == [5, 8]
    assert [child["section_id"] for child in first["sections"]] == ["1.1", "1.2"]
    assert first["sections"][1]["paper_section_range"] == [3, 4]
    assert first["sections"][0]["sections"] == []
    with session_factory() as db:
        assert db.get(DocumentTree, PAPER) is not None


def test_tree_stops_below_min_words(session_factory: SessionFactory, paper: str) -> None:
    """
    Check sections shorter than min_words stay leaves

    Args:
        session_factory (SessionFactory): fixture
        paper (str): fixture
    Returns:
        None
    """
    DocumentTreeManager.request(PAPER, TreeParams(max_depth=5, min_words=PARAGRAPH_WORDS * 5))
    DocumentTreeManager.process_next()

    record = DocumentTreeManager.get(PAPER)
    assert record is not None
    assert all(section["sections"] == [] for section in record["tree"])


def test_tree_without_text_fails(session_factory: SessionFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Check a file without text fails with a reason

    Args:
        session_factory (SessionFactory): fixture
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    monkeypatch.setattr("controllers.DocumentTreeManager.read_text", lambda file: None)
    DocumentTreeManager.add_file_to_queue(PAPER)
    DocumentTreeManager.process_next()

    tasks = DocumentTreeManager.get_tasks(PAPER)
    assert tasks[0].state == "FAILED"
    assert tasks[0].result is not None and tasks[0].result.startswith("No readable text")


def test_blocks_returns_every_block(paper: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Check blocks come back in order and an empty file is rejected

    Args:
        paper (str): fixture
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    document = DocumentTreeManager.blocks(PAPER)
    assert document["block_count"] == PARAGRAPH_COUNT
    assert document["blocks"][1].startswith("p2 ")
    monkeypatch.setattr("controllers.DocumentTreeManager.read_text", lambda file: "")
    with pytest.raises(TreeInputError):
        DocumentTreeManager.blocks(PAPER)

def single_idea_llm(setting_prefix: str, prompt: str, input_text: Optional[str] = None) -> Tuple[str, str, str]:
    """
    Pretend to be the LLM: split the top level, then declare every section one idea

    Args:
        setting_prefix (str): settings prefix
        prompt (str): prompt with the range
        input_text (Optional[str]): numbered blocks
    Returns:
        Tuple[str, str, str]: AI type, model and JSON answer
    """
    if "larger document" in prompt:
        return "fake", "fake", "[]"
    return halving_llm(setting_prefix, prompt, input_text)


def test_auto_depth_lets_ai_stop_on_single_idea(
    session_factory: SessionFactory, paper: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Check an empty answer below the top level keeps the section as a leaf

    Args:
        session_factory (SessionFactory): fixture
        paper (str): fixture
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    monkeypatch.setattr("controllers.DocumentTreeManager.request_llm", single_idea_llm)
    DocumentTreeManager.request(PAPER, TreeParams(min_words=50))
    DocumentTreeManager.process_next()

    record = DocumentTreeManager.get(PAPER)
    assert record is not None
    assert len(record["tree"]) == 2
    assert all(section["sections"] == [] for section in record["tree"])


def test_prompt_rules_follow_auto_flags() -> None:
    """
    Check auto flags switch the count and stop rules of the prompt

    Returns:
        None
    """
    auto = build_prompt(TreeParams(), 1, 9, ["Methods"])
    fixed = build_prompt(TreeParams(auto_depth=False, auto_sections=False, max_sections=4), 1, 9, ["Methods"])
    assert "one per distinct idea" in auto and "empty JSON array" in auto
    assert "2 to 4 consecutive sections" in fixed and "empty JSON array" not in fixed
    assert "empty JSON array" not in build_prompt(TreeParams(), 1, 9, [])


def test_fixed_sections_cap_extra_answers() -> None:
    """
    Check sections beyond the fixed limit merge into the last kept one

    Returns:
        None
    """
    assert TreeParams(auto_sections=False, max_sections=3).sections_limit == 3
    assert TreeParams().sections_limit == 10
    assert TreeParams().depth_limit == 5


@pytest.mark.parametrize(("tree_type", "expected"), [(None, "summarization"), ("", "summarization"), ("Claude", "tree")])
def test_routing_falls_back_to_summaries(
    monkeypatch: pytest.MonkeyPatch, tree_type: Optional[str], expected: str
) -> None:
    """
    Check tree requests use the summaries routing until tree_type is set

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        tree_type (Optional[str]): stored tree provider
        expected (str): expected settings prefix
    Returns:
        None
    """
    monkeypatch.setattr("controllers.DocumentTreeManager.get_setting", lambda key: tree_type)
    assert routing_prefix() == expected

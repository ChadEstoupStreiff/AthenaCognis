import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.stateoftheart import (
    SORT_OPTIONS,
    STATUS_ALL,
    STATUS_MISSING,
    STATUS_TO_REVIEW,
    STATUS_VALIDATED,
    Paper,
    PaperInfo,
    filter_papers,
    short_authors,
)

PATH = "/shared/2025-01-02/uploads/attention.pdf"


def make_paper(path: str = PATH, **info: object) -> Paper:
    """
    Build paper with given metadata

    Args:
        path (str): file path
        **info (object): PaperInfo fields
    Returns:
        Paper: paper
    """
    return Paper(path=path, info=PaperInfo.from_dict(dict(info)))


def test_paper_path_properties() -> None:
    """
    Derive file name, date, stockpile key and fallback title from path

    Args:
        None
    Returns:
        None
    """
    paper = make_paper()
    assert paper.file_name == "attention.pdf"
    assert paper.upload_date == "2025-01-02"
    assert paper.stockpile_key == "sota_info_2025-01-02_attention.pdf"
    assert paper.display_title == "attention"


def test_from_dict_ignores_unknown_keys_and_casts() -> None:
    """
    Drop legacy table keys, stringify values, cast validated to bool

    Args:
        None
    Returns:
        None
    """
    info = PaperInfo.from_dict({"select": True, "Filename": "x", "year": 2021, "validated": 1, "doi": None})
    assert info.year == "2021"
    assert info.validated is True
    assert info.doi == ""
    assert isinstance(info.to_dict()["validated"], bool)


def test_status() -> None:
    """
    Classify paper as missing, to review or validated

    Args:
        None
    Returns:
        None
    """
    assert make_paper().status == STATUS_MISSING
    assert make_paper(title="T", authors="Doe, J").status == STATUS_TO_REVIEW
    assert make_paper(validated=True).status == STATUS_VALIDATED


def test_filter_and_sort() -> None:
    """
    Filter on status and query, sort by year

    Args:
        None
    Returns:
        None
    """
    old = make_paper("/shared/2025-01-01/uploads/a.pdf", title="Old work", authors="Doe, J", year="1999")
    new = make_paper("/shared/2025-01-03/uploads/b.pdf", title="New work", authors="Roe, A", year="2024")
    papers = [old, new]
    assert filter_papers(papers, STATUS_ALL, "roe") == [new]
    assert filter_papers(papers, STATUS_VALIDATED, "") == []
    assert SORT_OPTIONS["Newest first"](papers) == [new, old]
    assert SORT_OPTIONS["Oldest first"](papers) == [old, new]


def test_short_authors() -> None:
    """
    Keep family names, truncate long lists with et al.

    Args:
        None
    Returns:
        None
    """
    assert short_authors("Doe, John | Roe, Ann") == "Doe, Roe"
    assert short_authors("A, a | B, b | C, c | D, d") == "A, B, C et al."
    assert short_authors("") == ""

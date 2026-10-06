import sys
from pathlib import Path
from typing import List, Optional

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core import citations
from core.citations import (
    CitationRecord,
    analyze_paper,
    citation_edges,
    neighborhood,
    parse_tei_references,
    shared_references,
    title_key,
)
from core.stateoftheart import Paper, PaperInfo

TEI_REFERENCES = """<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><back><div><listBibl>
  <biblStruct><analytic><title level="a">Deep Residual Learning for Image Recognition</title></analytic>
    <monogr><title level="m">CVPR</title></monogr></biblStruct>
  <biblStruct><analytic><title level="a">Sharing data</title><idno type="DOI">10.1371/Journal.PONE.0000308</idno></analytic></biblStruct>
  <biblStruct><monogr><title level="m">Pattern Recognition and Machine Learning</title></monogr></biblStruct>
</listBibl></div></back></text></TEI>"""

ATTENTION = Paper("/shared/2025-01-01/uploads/attention.pdf", PaperInfo(title="Attention Is All You Need", doi="10.1/att"))
RESNET = Paper("/shared/2025-01-01/uploads/resnet.pdf", PaperInfo(title="Deep Residual Learning for Image Recognition"))
SHARING = Paper("/shared/2025-01-01/uploads/sharing.pdf", PaperInfo(title="Sharing data", doi="10.1371/journal.pone.0000308"))


def test_parse_tei_references() -> None:
    """
    Turn GROBID bibliography into lowercase DOI keys or title keys

    Args:
        None
    Returns:
        None
    """
    assert parse_tei_references(TEI_REFERENCES) == [
        "t:deep residual learning for image recognition",
        "doi:10.1371/journal.pone.0000308",
        "t:pattern recognition and machine learning",
    ]


def test_citation_edges_resolve_every_key_kind() -> None:
    """
    Link papers through OpenAlex id, DOI and title keys, count external works

    Args:
        None
    Returns:
        None
    """
    records = {
        ATTENTION.path: CitationRecord("W1", ["W2", "W99", "W98", "W1"], source="openalex"),
        RESNET.path: CitationRecord("W2", ["W99"], source="openalex"),
        SHARING.path: CitationRecord("", [title_key(RESNET.display_title), "doi:10.1/att", "t:unknown"], source="grobid"),
    }
    edges, external = citation_edges([ATTENTION, RESNET, SHARING], records)
    pairs = {(e.citing, e.cited) for e in edges}
    assert pairs == {(ATTENTION.path, RESNET.path), (SHARING.path, RESNET.path), (SHARING.path, ATTENTION.path)}
    assert dict(external) == {"W99": 2, "W98": 1}
    assert shared_references(external, min_citing=2, limit=10) == {"W99": 2}


def test_record_from_dict() -> None:
    """
    Parse stored record with missing fields

    Args:
        None
    Returns:
        None
    """
    record = CitationRecord.from_dict({"openalex_id": "W1", "references": ["W2"]})
    assert (record.openalex_id, record.references, record.cited_by_count, record.source) == ("W1", ["W2"], 0, "")


def stub_sources(
    monkeypatch: pytest.MonkeyPatch, openalex: Optional[CitationRecord], grobid: Optional[List[str]]
) -> None:
    """
    Replace OpenAlex and GROBID calls, None simulates failure

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
        openalex (Optional[CitationRecord]): OpenAlex result
        grobid (Optional[List[str]]): GROBID references, None raises connection error
    Returns:
        None
    """

    def fake_grobid(path: str) -> List[str]:
        """
        Return stubbed references or simulate GROBID down

        Args:
            path (str): PDF path
        Returns:
            List[str]: references
        Raises:
            requests.ConnectionError: when grobid stub is None
        """
        if grobid is None:
            raise requests.ConnectionError("down")
        return grobid

    monkeypatch.setattr(citations, "openalex_by_doi", lambda doi: openalex)
    monkeypatch.setattr(citations, "openalex_by_title", lambda title: openalex)
    monkeypatch.setattr(citations, "grobid_references", fake_grobid)


def test_analyze_prefers_openalex(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Keep OpenAlex references when available

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
    Returns:
        None
    """
    stub_sources(monkeypatch, CitationRecord("W1", ["W2"], 5, "openalex"), ["t:x"])
    assert analyze_paper(ATTENTION).references == ["W2"]


def test_analyze_falls_back_to_grobid_keeping_openalex_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Use GROBID bibliography when OpenAlex lists no reference, keep OpenAlex id

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
    Returns:
        None
    """
    stub_sources(monkeypatch, CitationRecord("W1", [], 5, "openalex"), ["t:x"])
    record = analyze_paper(ATTENTION)
    assert (record.openalex_id, record.references, record.source) == ("W1", ["t:x"], "grobid")


def test_analyze_nothing_found(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Return empty record marked "none" when every source fails

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
    Returns:
        None
    """
    stub_sources(monkeypatch, None, None)
    assert analyze_paper(ATTENTION) == CitationRecord(source="none")


def test_neighborhood_depth() -> None:
    """
    Reach neighbors hop by hop in both directions

    Args:
        None
    Returns:
        None
    """
    pairs = [("a", "b"), ("c", "b"), ("c", "d"), ("x", "y")]
    assert neighborhood(pairs, "a", 1) == {"a", "b"}
    assert neighborhood(pairs, "a", 2) == {"a", "b", "c"}
    assert neighborhood(pairs, "a", 3) == {"a", "b", "c", "d"}
    assert neighborhood(pairs, "lonely", 2) == {"lonely"}

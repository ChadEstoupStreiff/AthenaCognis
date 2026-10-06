import sys
from pathlib import Path
from typing import List, Optional

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core import reference_lookup
from core.reference_lookup import (
    fetch_online_info,
    merge_info,
    parse_tei_header,
    titles_match,
)
from core.stateoftheart import Paper, PaperInfo

TEI_HEADER = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title level="a" type="main">Attention Is All You Need</title></titleStmt>
      <publicationStmt><date type="published" when="2017-12-04">2017</date></publicationStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author><persName><forename type="first">Ashish</forename><surname>Vaswani</surname></persName></author>
            <author><persName><forename type="first">Noam</forename><forename type="middle">M</forename><surname>Shazeer</surname></persName></author>
            <author><affiliation>Google Brain</affiliation></author>
            <title level="a" type="main">Attention Is All You Need</title>
          </analytic>
          <monogr>
            <title level="j">Advances in Neural Information Processing Systems</title>
            <imprint>
              <biblScope unit="volume">30</biblScope>
              <biblScope unit="page" from="5998" to="6008"/>
              <date type="published" when="2017"/>
            </imprint>
          </monogr>
          <idno type="DOI">10.5555/3295222.3295349</idno>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
</TEI>"""

PDF_PATH = "/shared/2025-01-02/uploads/1706.03762v7.pdf"


def test_parse_tei_header() -> None:
    """
    Extract title, authors, venue, pages and DOI from GROBID TEI

    Args:
        None
    Returns:
        None
    """
    info = parse_tei_header(TEI_HEADER)
    assert info.title == "Attention Is All You Need"
    assert info.authors == "Vaswani, Ashish | Shazeer, Noam M"
    assert info.year == "2017"
    assert info.journal == "Advances in Neural Information Processing Systems"
    assert (info.volume, info.pages) == ("30", "5998-6008")
    assert info.url == "https://doi.org/10.5555/3295222.3295349"


def test_titles_match() -> None:
    """
    Accept case / punctuation / accent variants, reject other papers

    Args:
        None
    Returns:
        None
    """
    assert titles_match("Attention is all you need.", "ATTENTION IS ALL YOU NEED")
    assert titles_match("Réseaux de neurones", "Reseaux de neurones")
    assert not titles_match("Attention is not all you need: pure attention loses rank", "Attention is all you need")
    assert not titles_match("", "Anything")
    long_title = "A comprehensive survey of deep learning methods for medical image segmentation tasks"
    assert titles_match(long_title.replace("segmentation", "segmentatlon"), long_title)


def test_merge_info_keeps_base_flags() -> None:
    """
    Override non-empty fields only, keep validated and source of base

    Args:
        None
    Returns:
        None
    """
    base = PaperInfo(title="Old", url="https://keep.me", validated=True, source="manual")
    merged = merge_info(base, PaperInfo(title="New", source="crossref"))
    assert (merged.title, merged.url, merged.validated, merged.source) == ("New", "https://keep.me", True, "manual")


def stub_lookup(
    monkeypatch: pytest.MonkeyPatch,
    grobid: Optional[PaperInfo],
    by_doi: Optional[PaperInfo],
    by_title: List[PaperInfo],
) -> List[str]:
    """
    Replace network calls of lookup pipeline, record title queries

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
        grobid (Optional[PaperInfo]): GROBID result, None simulates GROBID down
        by_doi (Optional[PaperInfo]): CrossRef DOI result
        by_title (List[PaperInfo]): candidates returned by every title search
    Returns:
        List[str]: titles searched, filled during test
    """
    queries: List[str] = []

    def fake_grobid(path: str) -> Optional[PaperInfo]:
        """
        Return stubbed GROBID result or simulate connection failure

        Args:
            path (str): PDF path
        Returns:
            Optional[PaperInfo]: stubbed result
        Raises:
            requests.ConnectionError: when grobid stub is None
        """
        if grobid is None:
            raise requests.ConnectionError("grobid down")
        return grobid

    def fake_title_search(title: str) -> List[PaperInfo]:
        """
        Record query and return stubbed candidates

        Args:
            title (str): searched title
        Returns:
            List[PaperInfo]: candidates
        """
        queries.append(title)
        return by_title

    monkeypatch.setattr(reference_lookup, "grobid_header", fake_grobid)
    monkeypatch.setattr(reference_lookup, "crossref_by_doi", lambda doi: by_doi)
    monkeypatch.setattr(reference_lookup, "TITLE_SEARCHERS", [fake_title_search])
    return queries


def test_doi_from_grobid_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Use CrossRef DOI record over GROBID fields, skip title search

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
    Returns:
        None
    """
    extracted = PaperInfo(title="Attention Is All You Need", doi="10.1/x", journal="NIPS")
    crossref = PaperInfo(title="Attention is all you need", doi="10.1/x", journal="NeurIPS", source="crossref")
    queries = stub_lookup(monkeypatch, extracted, crossref, [])
    info = fetch_online_info(Paper(PDF_PATH, PaperInfo(validated=True)))
    assert info is not None
    assert (info.journal, info.source, info.validated) == ("NeurIPS", "grobid + crossref", False)
    assert queries == []


def test_grobid_title_used_instead_of_file_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Search with GROBID title, not cryptic file name, reject mismatching candidates

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
    Returns:
        None
    """
    wrong = PaperInfo(title="Attention is not all you need", source="crossref")
    queries = stub_lookup(monkeypatch, PaperInfo(title="Attention Is All You Need"), None, [wrong])
    info = fetch_online_info(Paper(PDF_PATH, PaperInfo()))
    assert queries == ["Attention Is All You Need"]
    assert info is not None
    assert (info.title, info.source) == ("Attention Is All You Need", "grobid")


def test_fallback_to_file_name_when_grobid_down(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Search by file name when GROBID unreachable, None when nothing matches

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest fixture
    Returns:
        None
    """
    queries = stub_lookup(monkeypatch, None, None, [PaperInfo(title="Unrelated")])
    assert fetch_online_info(Paper(PDF_PATH, PaperInfo())) is None
    assert queries == ["1706.03762v7"]

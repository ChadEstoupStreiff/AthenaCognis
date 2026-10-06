import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from core.bibliography import (
    BibEntry,
    bibtex_citations,
    build_zip,
    collect_sources,
    parse_bibtex,
    parse_ris,
    parse_sources,
    plan_import,
    to_bibtex,
    to_ris,
)
from core.stateoftheart import Paper, PaperInfo

ZOTERO_BIBTEX = r"""
@article{vaswani_attention_2017,
  title = {Attention Is {All} You Need},
  author = {Vaswani, Ashish and Noam Shazeer},
  journal = {Advances in Neural Information Processing Systems},
  volume = {30},
  pages = {5998--6008},
  year = {2017},
  file = {Full Text PDF:files/12/Vaswani et al. - 2017 - Attention.pdf:application/pdf},
}
@inproceedings{he_2016,
  title = {Deep Residual Learning for Image Recognition},
  author = {He, Kaiming},
  booktitle = {CVPR},
  date = {2016-06},
  doi = {10.1109/CVPR.2016.90},
}
"""

ZOTERO_RIS = """TY  - JOUR
TI  - Sharing Detailed Research Data Is Associated with Increased Citation Rate
AU  - Piwowar, Heather A.
AU  - Day, Roger S.
T2  - PLoS ONE
PY  - 2007/03/21/
VL  - 2
IS  - 3
SP  - e308
DO  - 10.1371/journal.pone.0000308
L1  - files/7/Piwowar - 2007 - Sharing.pdf
ER  - 
"""

INFO = PaperInfo(
    title="Attention Is All You Need", authors="Vaswani, Ashish | Shazeer, Noam", year="2017",
    journal="NeurIPS", volume="30", pages="5998-6008", doi="10.1/x", url="https://doi.org/10.1/x",
)


def test_parse_zotero_bibtex() -> None:
    """
    Read authors, venue, pages, DOI and attachment of Zotero BibTeX

    Args:
        None
    Returns:
        None
    """
    attention, resnet = parse_bibtex(ZOTERO_BIBTEX)
    assert attention.info.title == "Attention Is All You Need"
    assert attention.info.authors == "Vaswani, Ashish | Shazeer, Noam"
    assert attention.info.pages == "5998-6008"
    assert attention.attachment == "Vaswani et al. - 2017 - Attention.pdf"
    assert (resnet.info.journal, resnet.info.year) == ("CVPR", "2016")
    assert resnet.info.url == "https://doi.org/10.1109/CVPR.2016.90"


def test_parse_zotero_ris() -> None:
    """
    Read RIS record with BOM-free tags, page start and PDF link

    Args:
        None
    Returns:
        None
    """
    (entry,) = parse_ris("﻿" + ZOTERO_RIS)
    assert entry.info.authors == "Piwowar, Heather A. | Day, Roger S."
    assert (entry.info.year, entry.info.issue, entry.info.pages) == ("2007", "3", "e308")
    assert entry.attachment == "Piwowar - 2007 - Sharing.pdf"


def test_ris_round_trip() -> None:
    """
    Parse back exported RIS without losing fields

    Args:
        None
    Returns:
        None
    """
    (entry,) = parse_ris(to_ris([BibEntry(INFO, attachment="a.pdf")]))
    assert entry.attachment == "a.pdf"
    assert {k: v for k, v in entry.info.to_dict().items() if k != "source"} == {
        k: v for k, v in INFO.to_dict().items() if k != "source"
    }


def test_bibtex_round_trip_and_unique_keys() -> None:
    """
    Parse back exported BibTeX, keep keys unique for duplicates

    Args:
        None
    Returns:
        None
    """
    text = to_bibtex([BibEntry(INFO, attachment="a.pdf"), BibEntry(INFO)])
    assert "@article{Vaswani2017Attention," in text and "@article{Vaswani2017Attentiona," in text
    first, _ = parse_bibtex(text)
    assert (first.info.title, first.info.authors, first.info.pages) == (INFO.title, INFO.authors, INFO.pages)
    assert first.attachment == "a.pdf"


def test_bibtex_citations_empty_fields_regression() -> None:
    """
    Format BibTeX without crash when authors and title empty

    Args:
        None
    Returns:
        None
    """
    assert bibtex_citations([PaperInfo().to_dict()]).startswith("@article{ref,")


def test_collect_sources_from_zotero_zip() -> None:
    """
    Read bibliography and PDFs from zipped Zotero export folder

    Args:
        None
    Returns:
        None
    """
    archive = build_zip("export.ris", ZOTERO_RIS, {"Piwowar - 2007 - Sharing.pdf": b"%PDF"})
    sources = collect_sources([("export.zip", archive), ("extra.bib", ZOTERO_BIBTEX.encode())])
    assert set(sources.pdfs) == {"Piwowar - 2007 - Sharing.pdf"}
    assert len(parse_sources(sources)) == 3


def test_plan_import() -> None:
    """
    Update paper matched by DOI or title, add entry with PDF, skip the rest

    Args:
        None
    Returns:
        None
    """
    by_doi = Paper("/shared/2025-01-01/uploads/x.pdf", PaperInfo(doi="10.1109/cvpr.2016.90"))
    by_name = Paper("/shared/2025-01-01/uploads/Attention is all you need.pdf", PaperInfo())
    entries = parse_bibtex(ZOTERO_BIBTEX) + parse_ris(ZOTERO_RIS)
    entries.append(BibEntry(PaperInfo(title="Unknown paper")))
    plan = plan_import(entries, [by_doi, by_name], {"Piwowar - 2007 - Sharing.pdf"})
    assert [item.action for item in plan] == ["update", "update", "add", "skip"]
    assert (plan[0].existing, plan[1].existing) == (by_name, by_doi)

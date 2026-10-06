import logging
import re
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import fields
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Optional, TypeVar
from urllib.parse import quote

import requests

from core.stateoftheart import BACK_URL, REQUEST_TIMEOUT_SECONDS, Paper, PaperInfo

GROBID_URL = "http://grobid:8070"
GROBID_TIMEOUT_SECONDS = 120
CROSSREF_URL = "https://api.crossref.org/works"
ARXIV_URL = "https://export.arxiv.org/api/query"
PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_SUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

PDF_EXTENSION = ".pdf"
SEARCH_CANDIDATES = 3
TITLE_MATCH_THRESHOLD = 0.9
WORDS_PER_ALLOWED_TYPO = 10
AUTHOR_SEPARATOR = " | "
UNMERGED_FIELDS = {"validated", "source"}
LOOKUP_ERRORS = (requests.RequestException, ValueError, KeyError, ET.ParseError)

TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

T = TypeVar("T")
logger = logging.getLogger(__name__)


# ---------- GENERIC HELPERS ----------


def collapse(text: Optional[str]) -> str:
    """
    Collapse whitespace of text, empty string for None

    Args:
        text (Optional[str]): raw text
    Returns:
        str: single-spaced stripped text
    """
    return " ".join((text or "").split())


def find_year(text: str) -> str:
    """
    Extract first 4-digit year of text

    Args:
        text (str): date-like text
    Returns:
        str: year, empty when none
    """
    match = re.search(r"\b(\d{4})\b", text)
    return match.group(1) if match else ""


def normalize_title(title: str) -> str:
    """
    Lowercase title, strip accents and punctuation for comparison

    Args:
        title (str): raw title
    Returns:
        str: normalized title
    """
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return collapse(re.sub(r"[^a-z0-9]+", " ", ascii_title.lower()))


def titles_match(candidate: str, expected: str) -> bool:
    """
    Check whether two titles designate same paper

    Args:
        candidate (str): title returned by search engine
        expected (str): title searched
    Returns:
        bool: True when characters are similar and almost no word differs
    """
    left, right = normalize_title(candidate), normalize_title(expected)
    if not left or not right:
        return False
    left_words, right_words = left.split(), right.split()
    allowed_typos = max(len(left_words), len(right_words)) // WORDS_PER_ALLOWED_TYPO
    differing_words = set(left_words) ^ set(right_words)
    if len(differing_words) > 2 * allowed_typos:
        return False
    return SequenceMatcher(None, left, right).ratio() >= TITLE_MATCH_THRESHOLD


def merge_info(base: PaperInfo, override: PaperInfo) -> PaperInfo:
    """
    Overlay non-empty fields of override on base

    Args:
        base (PaperInfo): fallback metadata
        override (PaperInfo): preferred metadata
    Returns:
        PaperInfo: merged metadata, validated and source taken from base
    """
    merged = base.to_dict()
    for field in fields(PaperInfo):
        value = getattr(override, field.name)
        if field.name not in UNMERGED_FIELDS and value:
            merged[field.name] = value
    return PaperInfo.from_dict(merged)


def safe_call(func: Callable[[str], T], argument: str) -> Optional[T]:
    """
    Run network lookup, log and swallow expected failures

    Args:
        func (Callable[[str], T]): lookup function
        argument (str): lookup argument
    Returns:
        Optional[T]: lookup result, None on failure
    """
    try:
        return func(argument)
    except LOOKUP_ERRORS as error:
        logger.warning("%s(%r) failed: %s", func.__name__, argument, error)
        return None


# ---------- GROBID ----------


def tei_text(element: Optional[ET.Element]) -> str:
    """
    Return collapsed inner text of TEI element

    Args:
        element (Optional[ET.Element]): element or None
    Returns:
        str: text, empty when element missing
    """
    return collapse("".join(element.itertext())) if element is not None else ""


def tei_authors(bibl: Optional[ET.Element]) -> str:
    """
    Read authors of TEI biblStruct as "Family, Given | ..."

    Args:
        bibl (Optional[ET.Element]): biblStruct element
    Returns:
        str: pipe-separated authors
    """
    if bibl is None:
        return ""
    authors: List[str] = []
    for person in bibl.findall("tei:analytic/tei:author/tei:persName", TEI_NS):
        family = tei_text(person.find("tei:surname", TEI_NS))
        given = " ".join(tei_text(f) for f in person.findall("tei:forename", TEI_NS))
        if family:
            authors.append(f"{family}, {given}" if given else family)
    return AUTHOR_SEPARATOR.join(authors)


def tei_pages(imprint: Optional[ET.Element]) -> str:
    """
    Read page range of TEI imprint

    Args:
        imprint (Optional[ET.Element]): imprint element
    Returns:
        str: "from-to", single page or empty
    """
    scope = imprint.find("tei:biblScope[@unit='page']", TEI_NS) if imprint is not None else None
    if scope is None:
        return ""
    page_range = [p for p in (scope.get("from"), scope.get("to")) if p]
    return "-".join(page_range) if page_range else tei_text(scope)


def parse_tei_header(tei: str) -> PaperInfo:
    """
    Convert GROBID TEI header into PaperInfo

    Args:
        tei (str): TEI XML from /api/processHeaderDocument
    Returns:
        PaperInfo: extracted metadata
    Raises:
        ET.ParseError: when TEI is not valid XML
    """
    root = ET.fromstring(tei)
    bibl = root.find(".//tei:sourceDesc/tei:biblStruct", TEI_NS)
    imprint = bibl.find("tei:monogr/tei:imprint", TEI_NS) if bibl is not None else None
    title = tei_text(root.find(".//tei:analytic/tei:title", TEI_NS)) or tei_text(
        root.find(".//tei:titleStmt/tei:title", TEI_NS)
    )
    date = root.find(".//tei:date[@type='published']", TEI_NS)
    doi = tei_text(root.find(".//tei:idno[@type='DOI']", TEI_NS))
    arxiv_id = tei_text(root.find(".//tei:idno[@type='arXiv']", TEI_NS))
    scopes = {
        unit: tei_text(imprint.find(f"tei:biblScope[@unit='{unit}']", TEI_NS)) if imprint is not None else ""
        for unit in ("volume", "issue")
    }
    url = f"https://doi.org/{doi}" if doi else (f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else "")
    return PaperInfo(
        title=title,
        authors=tei_authors(bibl),
        year=find_year(date.get("when", "") or tei_text(date)) if date is not None else "",
        journal=tei_text(root.find(".//tei:monogr/tei:title[@level='j']", TEI_NS)),
        url=url,
        doi=doi,
        volume=scopes["volume"],
        issue=scopes["issue"],
        pages=tei_pages(imprint),
    )


def download_paper(path: str) -> bytes:
    """
    Download file content from backend

    Args:
        path (str): file path
    Returns:
        bytes: file content
    Raises:
        requests.HTTPError: when backend refuses download
    """
    response = requests.get(f"{BACK_URL}/files/download/{quote(path)}", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.content


def grobid_header(path: str) -> Optional[PaperInfo]:
    """
    Extract header metadata of PDF with GROBID, consolidated against CrossRef

    Args:
        path (str): PDF file path
    Returns:
        Optional[PaperInfo]: extracted metadata, None when GROBID finds no header
    Raises:
        requests.RequestException: when backend or GROBID unreachable
    """
    response = requests.post(
        f"{GROBID_URL}/api/processHeaderDocument",
        files={"input": ("paper.pdf", download_paper(path), "application/pdf")},
        data={"consolidateHeader": "1"},
        headers={"Accept": "application/xml"},
        timeout=GROBID_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    if not response.text.strip():
        return None
    info = parse_tei_header(response.text)
    return info if info.title or info.doi else None


# ---------- ONLINE SOURCES ----------


def crossref_authors(item: Dict[str, Any]) -> str:
    """
    Read authors of CrossRef record

    Args:
        item (Dict[str, Any]): CrossRef work
    Returns:
        str: pipe-separated authors
    """
    names = []
    for author in item.get("author", []) or []:
        family, given = collapse(author.get("family")), collapse(author.get("given"))
        names.append(", ".join(n for n in (family, given) if n) or collapse(author.get("name")))
    return AUTHOR_SEPARATOR.join(n for n in names if n)


def crossref_to_info(item: Dict[str, Any]) -> PaperInfo:
    """
    Convert CrossRef work record into PaperInfo

    Args:
        item (Dict[str, Any]): CrossRef work
    Returns:
        PaperInfo: normalized metadata
    """
    doi = item.get("DOI", "")
    year = ""
    for date_key in ("published-print", "published-online", "issued"):
        parts = item.get(date_key, {}).get("date-parts") or [[None]]
        if parts[0] and parts[0][0]:
            year = str(parts[0][0])
            break
    return PaperInfo(
        title=collapse((item.get("title") or [""])[0]),
        authors=crossref_authors(item),
        year=year,
        journal=collapse((item.get("container-title") or [""])[0]),
        url=f"https://doi.org/{doi}" if doi else item.get("URL", ""),
        doi=doi,
        volume=item.get("volume", ""),
        issue=item.get("issue", ""),
        pages=item.get("page", ""),
        source="crossref",
    )


def crossref_by_doi(doi: str) -> Optional[PaperInfo]:
    """
    Fetch exact CrossRef record of DOI

    Args:
        doi (str): DOI
    Returns:
        Optional[PaperInfo]: metadata, None when DOI unknown
    """
    response = requests.get(f"{CROSSREF_URL}/{quote(doi)}", timeout=REQUEST_TIMEOUT_SECONDS)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return crossref_to_info(response.json()["message"])


def crossref_by_title(title: str) -> List[PaperInfo]:
    """
    Search CrossRef best candidates for title

    Args:
        title (str): paper title
    Returns:
        List[PaperInfo]: candidates, best first
    """
    params: Dict[str, str | int] = {"query.bibliographic": title, "rows": SEARCH_CANDIDATES}
    response = requests.get(CROSSREF_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return [crossref_to_info(item) for item in response.json()["message"]["items"]]


def pubmed_to_info(pmid: str, summary: Dict[str, Any]) -> PaperInfo:
    """
    Convert PubMed summary into PaperInfo

    Args:
        pmid (str): PubMed id
        summary (Dict[str, Any]): esummary record
    Returns:
        PaperInfo: normalized metadata
    """
    authors = []
    for author in summary.get("authors", []):
        parts = collapse(author.get("name")).split(" ", 1)
        authors.append(", ".join(parts))
    doi = next((a["value"] for a in summary.get("articleids", []) if a.get("idtype") == "doi"), "")
    return PaperInfo(
        title=collapse(summary.get("title")).rstrip("."),
        authors=AUTHOR_SEPARATOR.join(a for a in authors if a),
        year=find_year(summary.get("pubdate", "")),
        journal=collapse(summary.get("fulljournalname") or summary.get("source")),
        url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        doi=doi,
        volume=summary.get("volume", ""),
        issue=summary.get("issue", ""),
        pages=summary.get("pages", ""),
        source="pubmed",
    )


def pubmed_by_title(title: str) -> List[PaperInfo]:
    """
    Search PubMed best candidates for title

    Args:
        title (str): paper title
    Returns:
        List[PaperInfo]: candidates, best first
    """
    search_params: Dict[str, str | int] = {
        "db": "pubmed", "term": f"{title}[Title]", "retmax": SEARCH_CANDIDATES, "retmode": "json",
    }
    search = requests.get(PUBMED_SEARCH_URL, params=search_params, timeout=REQUEST_TIMEOUT_SECONDS)
    search.raise_for_status()
    pmids: List[str] = search.json()["esearchresult"]["idlist"]
    if not pmids:
        return []
    summary_params = {"db": "pubmed", "id": ",".join(pmids), "retmode": "json"}
    summary = requests.get(PUBMED_SUMMARY_URL, params=summary_params, timeout=REQUEST_TIMEOUT_SECONDS)
    summary.raise_for_status()
    result = summary.json()["result"]
    return [pubmed_to_info(pmid, result[pmid]) for pmid in pmids if pmid in result]


def arxiv_to_info(entry: ET.Element) -> PaperInfo:
    """
    Convert arXiv Atom entry into PaperInfo

    Args:
        entry (ET.Element): Atom entry
    Returns:
        PaperInfo: normalized metadata
    """
    authors = []
    for author in entry.findall("atom:author", ATOM_NS):
        parts = collapse(author.findtext("atom:name", "", ATOM_NS)).rsplit(" ", 1)
        authors.append(", ".join(reversed(parts)))
    doi = collapse(entry.findtext("arxiv:doi", "", ATOM_NS))
    return PaperInfo(
        title=collapse(entry.findtext("atom:title", "", ATOM_NS)),
        authors=AUTHOR_SEPARATOR.join(a for a in authors if a),
        year=find_year(entry.findtext("atom:published", "", ATOM_NS)),
        journal=collapse(entry.findtext("arxiv:journal_ref", "", ATOM_NS)) or "arXiv",
        url=collapse(entry.findtext("atom:id", "", ATOM_NS)),
        doi=doi,
        source="arxiv",
    )


def arxiv_by_title(title: str) -> List[PaperInfo]:
    """
    Search arXiv best candidates for title

    Args:
        title (str): paper title
    Returns:
        List[PaperInfo]: candidates, best first
    """
    params: Dict[str, str | int] = {
        "search_query": f'ti:"{title.replace(chr(34), "")}"', "max_results": SEARCH_CANDIDATES,
    }
    response = requests.get(ARXIV_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    root = ET.fromstring(response.text)
    return [arxiv_to_info(entry) for entry in root.findall("atom:entry", ATOM_NS)]


TITLE_SEARCHERS: List[Callable[[str], List[PaperInfo]]] = [crossref_by_title, pubmed_by_title, arxiv_by_title]


def search_by_title(title: str) -> Optional[PaperInfo]:
    """
    Find first candidate whose title really matches, across all sources

    Args:
        title (str): paper title
    Returns:
        Optional[PaperInfo]: matching metadata, None when no source matches
    """
    for searcher in TITLE_SEARCHERS:
        for candidate in safe_call(searcher, title) or []:
            if titles_match(candidate.title, title):
                return candidate
    return None


# ---------- PIPELINE ----------


def lookup_online(extracted: Optional[PaperInfo], title: str) -> Optional[PaperInfo]:
    """
    Resolve metadata online, by DOI first then by verified title match

    Args:
        extracted (Optional[PaperInfo]): metadata read from PDF
        title (str): title to search when no DOI resolves
    Returns:
        Optional[PaperInfo]: online metadata, None when nothing found
    """
    if extracted is not None and extracted.doi:
        by_doi = safe_call(crossref_by_doi, extracted.doi)
        if by_doi is not None:
            return by_doi
    return search_by_title(title) if title else None


def fetch_online_info(paper: Paper) -> Optional[PaperInfo]:
    """
    Read PDF header with GROBID, then complete it from CrossRef / PubMed / arXiv

    Args:
        paper (Paper): paper to look up
    Returns:
        Optional[PaperInfo]: merged metadata (not validated), None when nothing found
    """
    is_pdf = paper.file_name.lower().endswith(PDF_EXTENSION)
    extracted = safe_call(grobid_header, paper.path) if is_pdf else None
    title = extracted.title if extracted is not None and extracted.title else paper.display_title
    online = lookup_online(extracted, title)
    sources = [s for s in ("grobid" if extracted else "", online.source if online else "") if s]
    if not sources:
        return None
    merged = merge_info(merge_info(paper.info, extracted or PaperInfo()), online or PaperInfo())
    merged.source = " + ".join(sources)
    merged.validated = False
    return merged

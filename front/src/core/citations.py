import json
import logging
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

from core.reference_lookup import (
    GROBID_TIMEOUT_SECONDS,
    GROBID_URL,
    PDF_EXTENSION,
    TEI_NS,
    download_paper,
    normalize_title,
    safe_call,
    tei_text,
    titles_match,
)
from core.stateoftheart import BACK_URL, REQUEST_TIMEOUT_SECONDS, Paper

OPENALEX_URL = "https://api.openalex.org/works"
OPENALEX_ID_PREFIX = "https://openalex.org/"
OPENALEX_FIELDS = "id,doi,display_name,publication_year,cited_by_count,referenced_works"
OPENALEX_EXTERNAL_FIELDS = "id,doi,display_name,publication_year,cited_by_count,authorships"
OPENALEX_SEARCH_CANDIDATES = 5
OPENALEX_BATCH_SIZE = 50
REFS_PREFIX = "sota_refs_"
DOI_REF_PREFIX = "doi:"
TITLE_REF_PREFIX = "t:"
TITLE_KEY_LENGTH = 60
MAX_STORED_REFERENCES = 150

logger = logging.getLogger(__name__)


@dataclass
class CitationRecord:
    """References of one library paper, as OpenAlex ids, DOIs or title keys."""

    openalex_id: str = ""
    references: List[str] = field(default_factory=list)
    cited_by_count: int = 0
    source: str = ""

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "CitationRecord":
        """
        Build record from stored dict

        Args:
            raw (Dict[str, Any]): stored record
        Returns:
            CitationRecord: parsed record
        """
        return cls(
            openalex_id=str(raw.get("openalex_id", "")),
            references=[str(r) for r in raw.get("references", [])],
            cited_by_count=int(raw.get("cited_by_count", 0)),
            source=str(raw.get("source", "")),
        )


@dataclass
class ExternalWork:
    """Paper outside library, cited by several library papers."""

    openalex_id: str
    title: str = ""
    year: str = ""
    first_author: str = ""
    doi: str = ""
    cited_by_count: int = 0
    library_citations: int = 0


@dataclass
class CitationEdge:
    """Directed citation from citing paper to cited paper or work."""

    citing: str
    cited: str


# ---------- KEYS ----------


def refs_key(paper: Paper) -> str:
    """
    Return stockpile key storing citation record of paper

    Args:
        paper (Paper): paper
    Returns:
        str: stockpile key
    """
    return f"{REFS_PREFIX}{paper.upload_date}_{paper.file_name}"


def short_openalex_id(raw_id: str) -> str:
    """
    Strip OpenAlex URL prefix from id

    Args:
        raw_id (str): "https://openalex.org/W123" or "W123"
    Returns:
        str: "W123"
    """
    return raw_id.removeprefix(OPENALEX_ID_PREFIX)


def title_key(title: str) -> str:
    """
    Build compact title reference key

    Args:
        title (str): title
    Returns:
        str: "t:" + truncated normalized title, empty when title empty
    """
    normalized = normalize_title(title)[:TITLE_KEY_LENGTH]
    return f"{TITLE_REF_PREFIX}{normalized}" if normalized else ""


# ---------- STORAGE ----------


def load_citation_record(paper: Paper) -> Optional[CitationRecord]:
    """
    Fetch stored citation record of paper

    Args:
        paper (Paper): paper
    Returns:
        Optional[CitationRecord]: record, None when never analyzed
    """
    response = requests.get(f"{BACK_URL}/stockpile/get/{refs_key(paper)}", timeout=REQUEST_TIMEOUT_SECONDS)
    if response.status_code != 200:
        return None
    try:
        return CitationRecord.from_dict(json.loads(response.json()))
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError) as error:
        logger.warning("Unreadable citation record for %s: %s", paper.path, error)
        return None


def save_citation_record(paper: Paper, record: CitationRecord) -> bool:
    """
    Store citation record of paper

    Args:
        paper (Paper): paper
        record (CitationRecord): record to store
    Returns:
        bool: True on success
    """
    response = requests.post(
        f"{BACK_URL}/stockpile/set/{refs_key(paper)}",
        params={"value": json.dumps(asdict(record))},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response.status_code == 200


# ---------- OPENALEX ----------


def openalex_to_record(work: Dict[str, Any]) -> CitationRecord:
    """
    Convert OpenAlex work into citation record

    Args:
        work (Dict[str, Any]): OpenAlex work
    Returns:
        CitationRecord: record
    """
    return CitationRecord(
        openalex_id=short_openalex_id(work.get("id", "")),
        references=[short_openalex_id(r) for r in work.get("referenced_works", [])][:MAX_STORED_REFERENCES],
        cited_by_count=int(work.get("cited_by_count") or 0),
        source="openalex",
    )


def openalex_by_doi(doi: str) -> Optional[CitationRecord]:
    """
    Fetch OpenAlex record of DOI

    Args:
        doi (str): DOI
    Returns:
        Optional[CitationRecord]: record, None when unknown
    """
    response = requests.get(
        f"{OPENALEX_URL}/doi:{doi}", params={"select": OPENALEX_FIELDS}, timeout=REQUEST_TIMEOUT_SECONDS
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return openalex_to_record(response.json())


def openalex_by_title(title: str) -> Optional[CitationRecord]:
    """
    Search OpenAlex for title, keep matching version with most references

    Args:
        title (str): paper title
    Returns:
        Optional[CitationRecord]: record, None when no title matches
    """
    params: Dict[str, str | int] = {
        "search": title, "per-page": OPENALEX_SEARCH_CANDIDATES, "select": OPENALEX_FIELDS,
    }
    response = requests.get(OPENALEX_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    matches = [w for w in response.json()["results"] if titles_match(w.get("display_name") or "", title)]
    if not matches:
        return None
    return openalex_to_record(max(matches, key=lambda w: len(w.get("referenced_works", []))))


def first_author(work: Dict[str, Any]) -> str:
    """
    Return family name of first author of OpenAlex work

    Args:
        work (Dict[str, Any]): OpenAlex work with authorships
    Returns:
        str: family name, empty when unknown
    """
    authorships = work.get("authorships") or []
    name = (authorships[0].get("author") or {}).get("display_name", "") if authorships else ""
    return name.split()[-1] if name else ""


def fetch_external_works(counts: Dict[str, int]) -> List[ExternalWork]:
    """
    Fetch metadata of external OpenAlex works by batches

    Args:
        counts (Dict[str, int]): OpenAlex id -> number of citing library papers
    Returns:
        List[ExternalWork]: works found
    Raises:
        requests.RequestException: when OpenAlex unreachable
    """
    ids = list(counts)
    works: List[ExternalWork] = []
    for start in range(0, len(ids), OPENALEX_BATCH_SIZE):
        batch = ids[start:start + OPENALEX_BATCH_SIZE]
        params: Dict[str, str | int] = {
            "filter": f"openalex_id:{'|'.join(batch)}", "select": OPENALEX_EXTERNAL_FIELDS,
            "per-page": OPENALEX_BATCH_SIZE,
        }
        response = requests.get(OPENALEX_URL, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        for work in response.json()["results"]:
            work_id = short_openalex_id(work["id"])
            works.append(ExternalWork(
                openalex_id=work_id, title=work.get("display_name") or "",
                year=str(work.get("publication_year") or ""), first_author=first_author(work),
                doi=(work.get("doi") or "").removeprefix("https://doi.org/"),
                cited_by_count=int(work.get("cited_by_count") or 0), library_citations=counts.get(work_id, 0),
            ))
    return works


# ---------- GROBID ----------


def parse_tei_references(tei: str) -> List[str]:
    """
    Convert GROBID TEI bibliography into reference keys

    Args:
        tei (str): TEI XML from /api/processReferences
    Returns:
        List[str]: "doi:..." when DOI known, else "t:..." title key
    Raises:
        ET.ParseError: when TEI is not valid XML
    """
    references: List[str] = []
    for bibl in ET.fromstring(tei).iterfind(".//tei:listBibl/tei:biblStruct", TEI_NS):
        doi = tei_text(bibl.find(".//tei:idno[@type='DOI']", TEI_NS)).lower()
        title = tei_text(bibl.find("tei:analytic/tei:title", TEI_NS)) or tei_text(
            bibl.find("tei:monogr/tei:title", TEI_NS)
        )
        key = f"{DOI_REF_PREFIX}{doi}" if doi else title_key(title)
        if key:
            references.append(key)
    return references[:MAX_STORED_REFERENCES]


def grobid_references(path: str) -> List[str]:
    """
    Extract bibliography of PDF with GROBID

    Args:
        path (str): PDF path
    Returns:
        List[str]: reference keys
    Raises:
        requests.RequestException: when backend or GROBID unreachable
    """
    response = requests.post(
        f"{GROBID_URL}/api/processReferences",
        files={"input": ("paper.pdf", download_paper(path), "application/pdf")},
        data={"consolidateCitations": "0"},
        headers={"Accept": "application/xml"},
        timeout=GROBID_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return parse_tei_references(response.text) if response.text.strip() else []


# ---------- ANALYSIS ----------


def analyze_paper(paper: Paper) -> CitationRecord:
    """
    Find references of paper: OpenAlex by DOI or title, GROBID bibliography as fallback

    Args:
        paper (Paper): paper
    Returns:
        CitationRecord: record, source "none" when nothing found
    """
    record: Optional[CitationRecord] = None
    if paper.info.doi:
        record = safe_call(openalex_by_doi, paper.info.doi)
    if record is None:
        record = safe_call(openalex_by_title, paper.display_title)
    if record is not None and record.references:
        return record
    is_pdf = paper.file_name.lower().endswith(PDF_EXTENSION)
    references = (safe_call(grobid_references, paper.path) or []) if is_pdf else []
    base = record or CitationRecord()
    if references:
        return CitationRecord(base.openalex_id, references, base.cited_by_count, "grobid")
    return CitationRecord(base.openalex_id, [], base.cited_by_count, base.source or "none")


def paper_keys(paper: Paper, record: Optional[CitationRecord]) -> Set[str]:
    """
    Return every key a reference may use to designate paper

    Args:
        paper (Paper): library paper
        record (Optional[CitationRecord]): its citation record
    Returns:
        Set[str]: OpenAlex id, DOI key and title key
    """
    keys = {title_key(paper.display_title)}
    if paper.info.doi:
        keys.add(f"{DOI_REF_PREFIX}{paper.info.doi.lower()}")
    if record is not None and record.openalex_id:
        keys.add(record.openalex_id)
    return {k for k in keys if k}


def citation_edges(
    papers: List[Paper], records: Dict[str, CitationRecord]
) -> Tuple[List[CitationEdge], Counter[str]]:
    """
    Resolve references to library papers, count unresolved OpenAlex references

    Args:
        papers (List[Paper]): library papers
        records (Dict[str, CitationRecord]): path -> citation record
    Returns:
        Tuple[List[CitationEdge], Counter[str]]: edges inside library, external OpenAlex id -> citing papers count
    """
    index = {key: p.path for p in papers for key in paper_keys(p, records.get(p.path))}
    edges: Dict[Tuple[str, str], CitationEdge] = {}
    external: Counter[str] = Counter()
    for paper in papers:
        record = records.get(paper.path)
        for reference in set(record.references) if record else set():
            target = index.get(reference)
            if target is not None and target != paper.path:
                edges[(paper.path, target)] = CitationEdge(citing=paper.path, cited=target)
            elif target is None and not reference.startswith((DOI_REF_PREFIX, TITLE_REF_PREFIX)):
                external[reference] += 1
    return list(edges.values()), external


def shared_references(external: Counter[str], min_citing: int, limit: int) -> Dict[str, int]:
    """
    Keep external works cited by at least min_citing library papers

    Args:
        external (Counter[str]): OpenAlex id -> citing papers count
        min_citing (int): minimum citing library papers
        limit (int): maximum works kept, most cited first
    Returns:
        Dict[str, int]: OpenAlex id -> citing papers count
    """
    return {work: count for work, count in external.most_common(limit) if count >= min_citing}



def neighborhood(pairs: List[Tuple[str, str]], start: str, depth: int) -> Set[str]:
    """
    Return nodes reachable from start within depth hops, ignoring direction

    Args:
        pairs (List[Tuple[str, str]]): edge endpoints
        start (str): starting node
        depth (int): maximum hops
    Returns:
        Set[str]: reached nodes, start included
    """
    adjacency: Dict[str, Set[str]] = {}
    for first, second in pairs:
        adjacency.setdefault(first, set()).add(second)
        adjacency.setdefault(second, set()).add(first)
    reached = {start}
    frontier = {start}
    for _ in range(depth):
        frontier = {n for node in frontier for n in adjacency.get(node, set())} - reached
        reached |= frontier
    return reached

import json
import logging
import re
from dataclasses import asdict, dataclass, fields
from typing import Any, Callable, Dict, List

import requests

BACK_URL = "http://back:80"
STOCKPILE_PREFIX = "sota_info_"
REQUEST_TIMEOUT_SECONDS = 10
MAX_DISPLAYED_AUTHORS = 3
PATH_DATE_INDEX = 2

STATUS_VALIDATED = "Validated"
STATUS_TO_REVIEW = "To review"
STATUS_MISSING = "Missing info"
STATUS_ALL = "All"
STATUS_FILTERS = [STATUS_ALL, STATUS_TO_REVIEW, STATUS_VALIDATED, STATUS_MISSING]
STATUS_BADGES: Dict[str, str] = {
    STATUS_VALIDATED: ":green-badge[:material/verified: Validated]",
    STATUS_TO_REVIEW: ":orange-badge[:material/rate_review: To review]",
    STATUS_MISSING: ":red-badge[:material/error: Missing info]",
}

logger = logging.getLogger(__name__)


@dataclass
class PaperInfo:
    """Bibliographic metadata of a state-of-the-art paper."""

    title: str = ""
    authors: str = ""
    year: str = ""
    journal: str = ""
    url: str = ""
    doi: str = ""
    volume: str = ""
    issue: str = ""
    pages: str = ""
    source: str = ""
    validated: bool = False

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "PaperInfo":
        """
        Build PaperInfo from stored dict, ignoring unknown keys

        Args:
            raw (Dict[str, Any]): stored metadata
        Returns:
            PaperInfo: parsed metadata
        """
        known = {f.name for f in fields(cls)}
        values: Dict[str, Any] = {}
        for key, value in raw.items():
            if key not in known or value is None:
                continue
            values[key] = bool(value) if key == "validated" else str(value)
        return cls(**values)

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert metadata to JSON-serializable dict

        Args:
            None
        Returns:
            Dict[str, Any]: metadata dict
        """
        return asdict(self)


@dataclass
class Paper:
    """State-of-the-art file with its metadata."""

    path: str
    info: PaperInfo

    @property
    def file_name(self) -> str:
        """
        Return file name from path

        Args:
            None
        Returns:
            str: file name
        """
        return self.path.split("/")[-1]

    @property
    def upload_date(self) -> str:
        """
        Return upload date folder from path

        Args:
            None
        Returns:
            str: upload date (YYYY-MM-DD)
        """
        parts = self.path.split("/")
        return parts[PATH_DATE_INDEX] if len(parts) > PATH_DATE_INDEX else ""

    @property
    def stockpile_key(self) -> str:
        """
        Return stockpile key storing metadata of this paper

        Args:
            None
        Returns:
            str: stockpile key
        """
        return f"{STOCKPILE_PREFIX}{self.upload_date}_{self.file_name}"

    @property
    def display_title(self) -> str:
        """
        Return title, or file name without extension when title missing

        Args:
            None
        Returns:
            str: title to display
        """
        if self.info.title.strip():
            return self.info.title.strip()
        return self.file_name.rsplit(".", 1)[0]

    @property
    def status(self) -> str:
        """
        Return review status of paper

        Args:
            None
        Returns:
            str: one of STATUS_VALIDATED, STATUS_TO_REVIEW, STATUS_MISSING
        """
        if self.info.validated:
            return STATUS_VALIDATED
        if not self.info.title.strip() or not self.info.authors.strip():
            return STATUS_MISSING
        return STATUS_TO_REVIEW


def short_authors(authors: str) -> str:
    """
    Shorten pipe-separated author list to family names, "et al." past limit

    Args:
        authors (str): authors as "Family, Given | Family, Given"
    Returns:
        str: short author string
    """
    names = [a.strip().split(",")[0].strip() for a in authors.split("|") if a.strip()]
    if len(names) > MAX_DISPLAYED_AUTHORS:
        return f"{', '.join(names[:MAX_DISPLAYED_AUTHORS])} et al."
    return ", ".join(names)


def matches_query(paper: Paper, query: str) -> bool:
    """
    Check whether paper title, authors, journal or file name contain query

    Args:
        paper (Paper): paper to test
        query (str): case-insensitive text
    Returns:
        bool: True when query empty or found
    """
    needle = query.strip().lower()
    if not needle:
        return True
    haystack = f"{paper.info.title} {paper.info.authors} {paper.info.journal} {paper.file_name}".lower()
    return needle in haystack


def filter_papers(papers: List[Paper], status: str, query: str) -> List[Paper]:
    """
    Keep papers matching status filter and text query

    Args:
        papers (List[Paper]): all papers
        status (str): one of STATUS_FILTERS
        query (str): free-text filter
    Returns:
        List[Paper]: filtered papers
    """
    return [
        p
        for p in papers
        if (status == STATUS_ALL or p.status == status) and matches_query(p, query)
    ]


def _year_key(paper: Paper) -> int:
    """
    Return numeric year for sorting, 0 when unknown

    Args:
        paper (Paper): paper
    Returns:
        int: year or 0
    """
    match = re.search(r"\d{4}", paper.info.year)
    return int(match.group(0)) if match else 0


SORT_OPTIONS: Dict[str, Callable[[List[Paper]], List[Paper]]] = {
    "Newest first": lambda ps: sorted(ps, key=_year_key, reverse=True),
    "Oldest first": lambda ps: sorted(ps, key=_year_key),
    "Title A → Z": lambda ps: sorted(ps, key=lambda p: p.display_title.lower()),
    "Recently added": lambda ps: sorted(ps, key=lambda p: p.upload_date, reverse=True),
}


def load_paper_info(path: str) -> PaperInfo:
    """
    Fetch stored metadata of file from backend stockpile

    Args:
        path (str): file path (/shared/<date>/<subfolder>/<name>)
    Returns:
        PaperInfo: stored metadata, empty when none or unreadable
    """
    key = Paper(path=path, info=PaperInfo()).stockpile_key
    response = requests.get(
        f"{BACK_URL}/stockpile/get/{key}", timeout=REQUEST_TIMEOUT_SECONDS
    )
    if response.status_code != 200:
        return PaperInfo()
    try:
        raw = json.loads(response.json())
    except (json.JSONDecodeError, TypeError) as error:
        logger.warning("Unreadable SOTA info for %s: %s", path, error)
        return PaperInfo()
    if not isinstance(raw, dict):
        return PaperInfo()
    return PaperInfo.from_dict(raw)


def save_paper_info(paper: Paper) -> bool:
    """
    Store paper metadata in backend stockpile

    Args:
        paper (Paper): paper to save
    Returns:
        bool: True on success
    """
    response = requests.post(
        f"{BACK_URL}/stockpile/set/{paper.stockpile_key}",
        params={"value": json.dumps(paper.info.to_dict())},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    return response.status_code == 200


def format_APA(files: List[Dict[str, Any]]) -> str:
    """Format a reference in APA style."""

    def format_APA_authors(authors: str) -> str:
        names = [a.strip() for a in authors.split("|") if a.strip()]
        if len(names) == 0:
            return ""
        elif len(names) == 1:
            return names[0]
        elif len(names) <= 7:
            return ", ".join(names[:-1]) + ", & " + names[-1]
        else:
            return ", ".join(names[:6]) + ", ... " + names[-1]

    result = ""
    for file in files:
        authors_str = format_APA_authors(file.get("authors", ""))
        year = file.get("year", "n.d.")
        title = file.get("title", "")
        journal = file.get("journal", "")
        volume = file.get("volume", "")
        issue = file.get("issue", "")
        pages = file.get("pages", "")
        doi = file.get("doi", "")
        reference = f"{authors_str} ({year}). {title}. {journal}"
        if volume:
            reference += f", {volume}"
        if issue:
            reference += f"({issue})"
        if pages:
            reference += f", {pages}"
        reference += "."
        if doi:
            reference += f" https://doi.org/{doi}"
        result += reference + "\n\n"
    return result.strip()


def format_Vancouver(files: List[Dict[str, Any]]) -> str:
    """Format a reference in Vancouver style."""

    def format_Vancouver_authors(authors: str) -> str:
        names = [a.strip() for a in authors.split("|") if a.strip()]
        if len(names) == 0:
            return ""
        elif len(names) <= 6:
            return ", ".join(names)
        else:
            return ", ".join(names[:6]) + ", et al."

    result = ""
    for file in files:
        authors_str = format_Vancouver_authors(file.get("authors", ""))
        year = file.get("year", "n.d.")
        title = file.get("title", "")
        journal = file.get("journal", "")
        volume = file.get("volume", "")
        issue = file.get("issue", "")
        pages = file.get("pages", "")
        doi = file.get("doi", "")
        reference = f"{authors_str}. {title}. {journal}."
        if volume:
            reference += f" {volume}"
        if issue:
            reference += f"({issue})"
        if pages:
            reference += f":{pages}"
        reference += f"; {year}."
        if doi:
            reference += f" doi: https://doi.org/{doi}"
        result += reference + "\n\n"
    return result.strip()

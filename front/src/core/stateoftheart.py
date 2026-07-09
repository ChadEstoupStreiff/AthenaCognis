import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List

import requests
import streamlit as st

# ---------- LOW-LEVEL SEARCHES ----------


def _search_crossref_by_title_raw(title: str) -> Dict[str, Any]:
    """Query CrossRef with a title and return the best matching raw record."""
    url = "https://api.crossref.org/works"
    params = {
        "query.bibliographic": title,
        "rows": 1,
        "sort": "score",
        "order": "desc",
    }
    r = requests.get(url, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    items = data.get("message", {}).get("items", [])
    if not items:
        raise ValueError(f"No result found in CrossRef for title: {title}")
    return items[0]


def _search_pubmed_by_title(title: str) -> Dict[str, Any]:
    """
    Query PubMed (NCBI E-utilities) with a title and return a normalized record.
    """
    # 1) ESearch: find the best PMID
    esearch_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    params = {
        "db": "pubmed",
        "term": f"{title}[Title]",
        "retmax": 1,
        "sort": "relevance",
        "retmode": "json",
    }
    r = requests.get(esearch_url, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    idlist = data.get("esearchresult", {}).get("idlist", [])
    if not idlist:
        raise ValueError(f"No result found in PubMed for title: {title}")
    pmid = idlist[0]

    # 2) ESummary: get metadata
    esummary_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
    params = {
        "db": "pubmed",
        "id": pmid,
        "retmode": "json",
    }
    r = requests.get(esummary_url, params=params, timeout=10)
    r.raise_for_status()
    data = r.json()
    result = data.get("result", {})
    summary = result.get(pmid, {})

    raw_title = (summary.get("title") or "").strip()
    raw_title = " ".join(raw_title.split())  # collapse whitespace

    # Authors -> 'Family, Given'
    raw_authors: str = ""
    for a in summary.get("authors", []):
        name = (a.get("name") or "").strip()  # usually "Surname Initials"
        if not name:
            continue
        # Split "Surname Initials" into "Surname, I."
        parts = name.split()
        raw_authors += " | "
        if len(parts) >= 2:
            family = parts[0]
            given = " ".join(parts[1:])
            raw_authors += f"{family}, {given}"
        else:
            raw_authors += name
    raw_authors = raw_authors.lstrip(" | ")

    # Year
    pubdate = (summary.get("pubdate") or "").strip()
    m = re.search(r"\b(\d{4})\b", pubdate)
    year = m.group(1) if m else "n.d."

    journal = (summary.get("fulljournalname") or summary.get("source") or "").strip()
    volume = (summary.get("volume") or "").strip()
    issue = (summary.get("issue") or "").strip()
    pages = (summary.get("pages") or "").strip()

    # DOI
    doi = ""
    for aid in summary.get("articleids", []):
        if aid.get("idtype") == "doi" and aid.get("value"):
            doi = aid["value"].strip()
            break

    url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

    return {
        "title": raw_title,
        "authors": raw_authors,
        "year": year,
        "journal": journal,
        "url": url,
        "doi": doi,
        "volume": volume,
        "issue": issue,
        "pages": pages,
        "source": "pubmed",
    }


def _search_arxiv_by_title(title: str) -> Dict[str, Any]:
    """
    Query arXiv with a title and return a normalized record.
    Uses the public Atom API.
    """
    base_url = "http://export.arxiv.org/api/query"
    # search by title, phrase match
    params = {
        "search_query": f'ti:"{title}"',
        "start": 0,
        "max_results": 1,
    }
    r = requests.get(base_url, params=params, timeout=10)
    r.raise_for_status()
    text = r.text

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "arxiv": "http://arxiv.org/schemas/atom",
    }
    root = ET.fromstring(text)
    entry = root.find("atom:entry", ns)
    if entry is None:
        raise ValueError(f"No result found in arXiv for title: {title}")

    raw_title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
    raw_title = " ".join(raw_title.split())  # collapse whitespace

    # authors -> list of "Family, Given" (best effort from 'Given Family' strings)
    raw_authors = ""
    for a in entry.findall("atom:author", ns):
        name = (a.findtext("atom:name", default="", namespaces=ns) or "").strip()
        if not name:
            continue
        parts = name.split()
        if len(parts) >= 2:
            family = parts[-1]
            given = " ".join(parts[:-1])
            raw_authors += f"{family}, {given}"
        else:
            raw_authors += name
    raw_authors = raw_authors.lstrip(" | ")

    published = entry.findtext("atom:published", default="", namespaces=ns) or ""
    year = published[:4] if len(published) >= 4 else "n.d."

    url = (entry.findtext("atom:id", default="", namespaces=ns) or "").strip()

    doi_elem = entry.find("arxiv:doi", ns)
    doi = doi_elem.text.strip() if doi_elem is not None and doi_elem.text else ""

    jr = entry.find("arxiv:journal_ref", ns)
    journal = jr.text.strip() if jr is not None and jr.text else ""

    return {
        "title": raw_title,
        "authors": raw_authors,
        "year": year,
        "journal": journal or "arXiv",
        "url": url or (f"https://doi.org/{doi}" if doi else ""),
        "doi": doi,
        "volume": "",
        "issue": "",
        "pages": "",
        "source": "arxiv",
    }


# ---------- NORMALIZATION & FORMATTING ----------


def _normalize_crossref_item(item: Dict[str, Any]) -> Dict[str, Any]:
    raw_title = item.get("title", [""])[0]
    authors = item.get("author", []) or []
    container = item.get("container-title", [""])
    journal = container[0] if container else ""
    doi = item.get("DOI", "")
    url = item.get("URL", "") or (f"https://doi.org/{doi}" if doi else "")

    # Year
    year = None
    for date_key in ["published-print", "published-online", "issued"]:
        if (
            date_key in item
            and "date-parts" in item[date_key]
            and item[date_key]["date-parts"]
        ):
            year = str(item[date_key]["date-parts"][0][0])
            break
    if year is None:
        year = "n.d."

    volume = item.get("volume", "") or ""
    issue = item.get("issue", "") or ""
    pages = item.get("page", "") or ""

    authors_list: str = ""
    for a in authors:
        fam = (a.get("family") or "").strip()
        giv = (a.get("given") or "").strip()
        if fam and giv:
            authors_list += f"{fam}, {giv}"
        elif fam:
            authors_list += fam
        elif giv:
            authors_list += giv
        authors_list += " | "
    authors_list = authors_list.rstrip(" | ")

    return {
        "title": raw_title,
        "authors": authors_list,
        "year": year,
        "journal": journal,
        "url": url,
        "doi": doi,
        "volume": volume,
        "issue": issue,
        "pages": pages,
        "source": "crossref",
    }


def format_APA(files: List[Dict[str, Any]]) -> str:
    """Format a reference in APA style."""

    def format_APA_authors(authors: str) -> str:
        authors = [a.strip() for a in authors.split("|") if a.strip()]
        if len(authors) == 0:
            return ""
        elif len(authors) == 1:
            return authors[0]
        elif len(authors) <= 7:
            return ", ".join(authors[:-1]) + ", & " + authors[-1]
        else:
            return ", ".join(authors[:6]) + ", ... " + authors[-1]

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


def get_reference_from_title(title: str) -> Dict[str, Any]:
    """
    Given an article title, search on CrossRef, then arXiv,
    and return a dict with core fields + formatted strings.

    Output dict contains at least:
      - title
      - authors (list of 'Family, Given')
      - year
      - journal
      - url
      - doi
      - volume
      - issue
      - pages
      - 'source' (crossref | arxiv)
    """
    last_error = None
    meta: Dict[str, Any] | None = None
    title = title.strip()
    if title.endswith(".pdf"):
        title = title[:-4]

    if meta is None:
        try:
            meta = _search_arxiv_by_title(title)
        except Exception as e:
            last_error = e
            # st.error(f"arXiv search error: {str(e)}")

    if meta is None:
        try:
            meta = _search_pubmed_by_title(title)
        except Exception as e:
            last_error = e
            # st.error(f"PubMed search error: {str(e)}")

    if meta is None:
        try:
            cr_item = _search_crossref_by_title_raw(title)
            meta = _normalize_crossref_item(cr_item)
        except Exception as e:
            last_error = e
            # st.error(f"CrossRef search error: {str(e)}")

    if meta is None:
        raise RuntimeError(
            f"Could not retrieve metadata for title '{title}'. Last error: {last_error}"
        )

    return meta


# ---------- FORMATTING HELPERS ----------


def format_Vancouver(files: List[Dict[str, Any]]) -> str:
    """Format a reference in Vancouver style."""

    def format_Vancouver_authors(authors: str) -> str:
        authors = [a.strip() for a in authors.split("|") if a.strip()]
        if len(authors) == 0:
            return ""
        elif len(authors) <= 6:
            return ", ".join(authors)
        else:
            return ", ".join(authors[:6]) + ", et al."

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


def format_BibTeX(files: List[Dict[str, Any]]) -> str:
    """Format a reference in BibTeX style."""
    result = ""
    for idx, file in enumerate(files):
        authors = " and ".join(file.get("authors", "").split("|"))
        year = file.get("year", "n.d.")
        title = file.get("title", "")
        journal = file.get("journal", "")
        volume = file.get("volume", "")
        issue = file.get("issue", "")
        pages = file.get("pages", "")
        doi = file.get("doi", "")
        refid = f"{authors.split(',')[0].split()[0]}{year}{title.split()[0]}"
        bibtex_entry = f"@article{{{refid},\n"
        bibtex_entry += f"  author = {{{authors}}},\n"
        bibtex_entry += f"  title = {{{title}}},\n"
        bibtex_entry += f"  journal = {{{journal}}},\n"
        if volume:
            bibtex_entry += f"  volume = {{{volume}}},\n"
        if issue:
            bibtex_entry += f"  number = {{{issue}}},\n"
        if pages:
            bibtex_entry += f"  pages = {{{pages}}},\n"
        bibtex_entry += f"  year = {{{year}}},\n"
        if doi:
            bibtex_entry += f"  doi = {{{doi}}},\n"
        bibtex_entry += "}\n\n"
        result += bibtex_entry
    return result.strip()

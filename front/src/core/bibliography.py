import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any, Dict, List, Optional, Set, Tuple

import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import convert_to_unicode

from core.reference_lookup import titles_match
from core.stateoftheart import Paper, PaperInfo

AUTHOR_SEPARATOR = " | "
BIBTEX_AUTHOR_SEPARATOR = " and "
ATTACHMENTS_FOLDER = "files"
BIBTEX_EXTENSION = ".bib"
RIS_EXTENSION = ".ris"
ZIP_EXTENSION = ".zip"
PDF_EXTENSION = ".pdf"
RIS_LINE = re.compile(r"^([A-Z][A-Z0-9])  -(?: (.*))?$")
PDF_PATH = re.compile(r"[^:;{}]+\.pdf", re.IGNORECASE)
ALPHABET = "abcdefghijklmnopqrstuvwxyz"


@dataclass
class BibEntry:
    """Bibliographic record with optional attached file name."""

    info: PaperInfo
    attachment: str = ""


@dataclass
class ImportPlanItem:
    """What import will do with one entry."""

    entry: BibEntry
    existing: Optional[Paper] = None
    pdf_name: str = ""

    @property
    def action(self) -> str:
        """
        Return planned action label

        Args:
            None
        Returns:
            str: "update", "add" or "skip"
        """
        if self.existing is not None:
            return "update"
        return "add" if self.pdf_name else "skip"


@dataclass
class ImportSources:
    """Bibliography texts and PDFs gathered from uploaded files."""

    bibtex: List[str] = field(default_factory=list)
    ris: List[str] = field(default_factory=list)
    pdfs: Dict[str, bytes] = field(default_factory=dict)


# ---------- SHARED HELPERS ----------


def file_basename(path: str) -> str:
    """
    Return file name of POSIX, Windows or file:// path

    Args:
        path (str): path or URL
    Returns:
        str: base name
    """
    cleaned = path.strip().removeprefix("file://")
    return PureWindowsPath(PurePosixPath(cleaned).name).name


def to_family_given(name: str) -> str:
    """
    Normalize author name to "Family, Given"

    Args:
        name (str): "Family, Given" or "Given Family"
    Returns:
        str: normalized name
    """
    name = " ".join(name.split())
    if "," in name or " " not in name:
        return name
    given, family = name.rsplit(" ", 1)
    return f"{family}, {given}"


def split_pages(pages: str) -> Tuple[str, str]:
    """
    Split page range into start and end

    Args:
        pages (str): "12-34", "12--34" or "e308"
    Returns:
        Tuple[str, str]: start page, end page (empty when single)
    """
    parts = [p.strip() for p in re.split(r"-+|–", pages, maxsplit=1)]
    return parts[0], parts[1] if len(parts) > 1 else ""


# ---------- BIBTEX ----------


def first_pdf(file_field: str) -> str:
    """
    Extract first PDF file name of BibTeX file field (Zotero / JabRef syntax)

    Args:
        file_field (str): e.g. "Full Text PDF:files/12/x.pdf:application/pdf"
    Returns:
        str: PDF base name, empty when none
    """
    match = PDF_PATH.search(file_field)
    return file_basename(match.group(0)) if match else ""


def bibtex_to_entry(record: Dict[str, str]) -> BibEntry:
    """
    Convert parsed BibTeX record into BibEntry

    Args:
        record (Dict[str, str]): bibtexparser entry (lowercase field names)
    Returns:
        BibEntry: normalized entry
    """
    authors = [to_family_given(a) for a in record.get("author", "").split(BIBTEX_AUTHOR_SEPARATOR) if a.strip()]
    doi = record.get("doi", "")
    info = PaperInfo(
        title=" ".join(record.get("title", "").split()),
        authors=AUTHOR_SEPARATOR.join(authors),
        year=record.get("year") or record.get("date", "")[:4],
        journal=record.get("journal") or record.get("journaltitle") or record.get("booktitle", ""),
        url=record.get("url") or (f"https://doi.org/{doi}" if doi else ""),
        doi=doi,
        volume=record.get("volume", ""),
        issue=record.get("number") or record.get("issue", ""),
        pages=record.get("pages", "").replace("--", "-"),
        source="bibtex",
    )
    return BibEntry(info=info, attachment=first_pdf(record.get("file", "")))


def parse_bibtex(text: str) -> List[BibEntry]:
    """
    Parse BibTeX document into entries

    Args:
        text (str): BibTeX content
    Returns:
        List[BibEntry]: entries having a title
    """
    parser = BibTexParser(common_strings=True)
    parser.customization = convert_to_unicode
    database = bibtexparser.loads(text, parser=parser)
    return [e for e in (bibtex_to_entry(r) for r in database.entries) if e.info.title]


def bibtex_key(info: PaperInfo, used_keys: Set[str]) -> str:
    """
    Build unique citation key "FamilyYearWord"

    Args:
        info (PaperInfo): reference
        used_keys (Set[str]): keys already taken, updated in place
    Returns:
        str: unique key
    """
    family = re.sub(r"\W", "", info.authors.split(",")[0].split("|")[0])
    first_word = re.sub(r"\W", "", (info.title.split() or [""])[0])
    base = f"{family}{info.year}{first_word}" or "ref"
    key = base
    for suffix in ALPHABET:
        if key not in used_keys:
            break
        key = f"{base}{suffix}"
    used_keys.add(key)
    return key


def bibtex_entry(entry: BibEntry, key: str) -> str:
    """
    Format one BibTeX @article entry

    Args:
        entry (BibEntry): reference with optional attachment
        key (str): citation key
    Returns:
        str: BibTeX entry
    """
    info = entry.info
    values = {
        "author": BIBTEX_AUTHOR_SEPARATOR.join(a.strip() for a in info.authors.split("|") if a.strip()),
        "title": info.title, "journal": info.journal, "year": info.year, "volume": info.volume,
        "number": info.issue, "pages": info.pages.replace("-", "--"), "doi": info.doi, "url": info.url,
        "file": f"{ATTACHMENTS_FOLDER}/{entry.attachment}" if entry.attachment else "",
    }
    lines = [f"  {name} = {{{value}}}," for name, value in values.items() if value]
    return "\n".join([f"@article{{{key},", *lines, "}"])


def to_bibtex(entries: List[BibEntry]) -> str:
    """
    Format entries as BibTeX document with unique keys

    Args:
        entries (List[BibEntry]): references
    Returns:
        str: BibTeX content
    """
    used_keys: Set[str] = set()
    return "\n\n".join(bibtex_entry(e, bibtex_key(e.info, used_keys)) for e in entries)



def bibtex_citations(references: List[Dict[str, Any]]) -> str:
    """
    Format reference dicts as BibTeX document

    Args:
        references (List[Dict[str, Any]]): PaperInfo dicts
    Returns:
        str: BibTeX content
    """
    return to_bibtex([BibEntry(info=PaperInfo.from_dict(r)) for r in references])

# ---------- RIS (Zotero, Mendeley, EndNote) ----------


def ris_records(text: str) -> List[Dict[str, List[str]]]:
    """
    Split RIS document into records of tag -> values

    Args:
        text (str): RIS content
    Returns:
        List[Dict[str, List[str]]]: one dict per record
    """
    records: List[Dict[str, List[str]]] = []
    current: Dict[str, List[str]] = {}
    for line in text.lstrip("﻿").splitlines():
        match = RIS_LINE.match(line.rstrip())
        if match is None:
            continue
        tag, value = match.group(1), (match.group(2) or "").strip()
        if tag == "ER":
            records.append(current)
            current = {}
        elif value:
            current.setdefault(tag, []).append(value)
    return records


def ris_to_entry(record: Dict[str, List[str]]) -> BibEntry:
    """
    Convert RIS record into BibEntry

    Args:
        record (Dict[str, List[str]]): tag -> values
    Returns:
        BibEntry: normalized entry
    """

    def first(*tags: str) -> str:
        """
        Return first value among tags

        Args:
            *tags (str): RIS tags by priority
        Returns:
            str: value, empty when none
        """
        return next((record[t][0] for t in tags if t in record), "")

    doi = first("DO")
    start, end = first("SP"), first("EP")
    pdfs = [v for v in record.get("L1", []) if v.lower().endswith(PDF_EXTENSION)]
    info = PaperInfo(
        title=first("TI", "T1"),
        authors=AUTHOR_SEPARATOR.join(to_family_given(a) for a in record.get("AU", []) + record.get("A1", [])),
        year=first("PY", "Y1", "DA")[:4],
        journal=first("T2", "JO", "JF", "JA"),
        url=first("UR") or (f"https://doi.org/{doi}" if doi else ""),
        doi=doi,
        volume=first("VL"),
        issue=first("IS"),
        pages=f"{start}-{end}" if start and end else start,
        source="ris",
    )
    return BibEntry(info=info, attachment=file_basename(pdfs[0]) if pdfs else "")


def parse_ris(text: str) -> List[BibEntry]:
    """
    Parse RIS document into entries

    Args:
        text (str): RIS content
    Returns:
        List[BibEntry]: entries having a title
    """
    return [e for e in (ris_to_entry(r) for r in ris_records(text)) if e.info.title]


def ris_entry(entry: BibEntry) -> str:
    """
    Format one RIS journal-article record

    Args:
        entry (BibEntry): reference with optional attachment
    Returns:
        str: RIS record
    """
    info = entry.info
    start, end = split_pages(info.pages)
    tags: List[Tuple[str, str]] = [("TY", "JOUR")]
    tags += [("AU", a.strip()) for a in info.authors.split("|") if a.strip()]
    tags += [("TI", info.title), ("T2", info.journal), ("PY", info.year), ("VL", info.volume),
             ("IS", info.issue), ("SP", start), ("EP", end), ("DO", info.doi), ("UR", info.url)]
    if entry.attachment:
        tags.append(("L1", f"{ATTACHMENTS_FOLDER}/{entry.attachment}"))
    lines = [f"{tag}  - {value}" for tag, value in tags if value]
    return "\n".join([*lines, "ER  - "])


def to_ris(entries: List[BibEntry]) -> str:
    """
    Format entries as RIS document

    Args:
        entries (List[BibEntry]): references
    Returns:
        str: RIS content
    """
    return "\n\n".join(ris_entry(e) for e in entries) + "\n"


# ---------- ARCHIVES ----------


def add_source(sources: ImportSources, name: str, content: bytes) -> None:
    """
    Store file content in sources according to its extension

    Args:
        sources (ImportSources): accumulator, updated in place
        name (str): file name
        content (bytes): file content
    Returns:
        None
    """
    lower_name = name.lower()
    if lower_name.endswith(BIBTEX_EXTENSION):
        sources.bibtex.append(content.decode("utf-8", errors="replace"))
    elif lower_name.endswith(RIS_EXTENSION):
        sources.ris.append(content.decode("utf-8", errors="replace"))
    elif lower_name.endswith(PDF_EXTENSION):
        sources.pdfs[file_basename(name)] = content


def collect_sources(uploads: List[Tuple[str, bytes]]) -> ImportSources:
    """
    Gather bibliographies and PDFs from uploaded files and zip archives

    Args:
        uploads (List[Tuple[str, bytes]]): (file name, content) pairs
    Returns:
        ImportSources: gathered sources
    Raises:
        zipfile.BadZipFile: when a .zip upload is corrupted
    """
    sources = ImportSources()
    for name, content in uploads:
        if not name.lower().endswith(ZIP_EXTENSION):
            add_source(sources, name, content)
            continue
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            for member in archive.infolist():
                if not member.is_dir() and "__MACOSX" not in member.filename:
                    add_source(sources, member.filename, archive.read(member))
    return sources


def parse_sources(sources: ImportSources) -> List[BibEntry]:
    """
    Parse every bibliography of sources

    Args:
        sources (ImportSources): gathered sources
    Returns:
        List[BibEntry]: all entries
    """
    entries = [e for text in sources.bibtex for e in parse_bibtex(text)]
    return entries + [e for text in sources.ris for e in parse_ris(text)]


def build_zip(bibliography_name: str, bibliography: str, pdfs: Dict[str, bytes]) -> bytes:
    """
    Pack bibliography and PDFs (under files/) into zip archive

    Args:
        bibliography_name (str): bibliography file name in archive
        bibliography (str): bibliography content
        pdfs (Dict[str, bytes]): PDF name -> content
    Returns:
        bytes: zip archive
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(bibliography_name, bibliography)
        for name, content in pdfs.items():
            archive.writestr(f"{ATTACHMENTS_FOLDER}/{name}", content)
    return buffer.getvalue()


# ---------- IMPORT PLAN ----------


def find_existing(info: PaperInfo, papers: List[Paper]) -> Optional[Paper]:
    """
    Find library paper describing same reference, by DOI then title

    Args:
        info (PaperInfo): imported reference
        papers (List[Paper]): library papers
    Returns:
        Optional[Paper]: matching paper, None when new
    """
    doi = info.doi.strip().lower()
    if doi:
        by_doi = next((p for p in papers if p.info.doi.strip().lower() == doi), None)
        if by_doi is not None:
            return by_doi
    return next((p for p in papers if titles_match(p.display_title, info.title)), None)


def plan_import(entries: List[BibEntry], papers: List[Paper], pdf_names: Set[str]) -> List[ImportPlanItem]:
    """
    Decide for each entry whether to update a paper, add a PDF, or skip

    Args:
        entries (List[BibEntry]): imported references
        papers (List[Paper]): library papers
        pdf_names (Set[str]): uploaded PDF names
    Returns:
        List[ImportPlanItem]: one plan item per entry
    """
    plan = []
    for entry in entries:
        existing = find_existing(entry.info, papers)
        pdf_name = entry.attachment if entry.attachment in pdf_names else ""
        plan.append(ImportPlanItem(entry=entry, existing=existing, pdf_name=pdf_name))
    return plan

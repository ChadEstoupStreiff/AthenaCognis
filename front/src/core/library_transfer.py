import datetime
import json
import zipfile
from dataclasses import dataclass, replace
from typing import Callable, Dict, List, Optional, Tuple

import requests
import streamlit as st
from stqdm import stqdm

from core.bibliography import (
    BibEntry,
    ImportPlanItem,
    build_zip,
    collect_sources,
    parse_sources,
    plan_import,
    to_bibtex,
    to_ris,
)
from core.reference_lookup import download_paper, merge_info
from core.stateoftheart import (
    BACK_URL,
    REQUEST_TIMEOUT_SECONDS,
    Paper,
    load_paper_info,
    save_paper_info,
)
from utils import toast_for_rerun

UPLOAD_TIMEOUT_SECONDS = 120
UPLOAD_SUBDIRECTORY = "uploads"
SCOPE_SELECTED = "selected"
SCOPE_SHOWN = "shown"
SCOPE_LIBRARY = "library"
LIBRARY_CACHE_KEY = "sota_library_cache"
EXPORT_RESULT_KEY = "sota_export_result"
ACTION_BADGES: Dict[str, str] = {
    "update": ":blue-badge[:material/sync: Update]",
    "add": ":green-badge[:material/add: Add]",
    "skip": ":gray-badge[:material/block: Skip]",
}
ZOTERO_HELP = (
    "In Zotero: **File → Export Library…** (or right-click a collection → Export), "
    "format **BibTeX** or **RIS**, tick **Export Files**, then zip the exported folder and drop the zip here."
)


@dataclass(frozen=True)
class ExportFormat:
    """Bibliography export format."""

    formatter: Callable[[List[BibEntry]], str]
    file_name: str
    mime: str


EXPORT_FORMATS: Dict[str, ExportFormat] = {
    "Zotero (RIS)": ExportFormat(to_ris, "references.ris", "application/x-research-info-systems"),
    "BibTeX": ExportFormat(to_bibtex, "references.bib", "application/x-bibtex"),
}


@dataclass
class ExportFile:
    """Generated export ready to download."""

    data: bytes
    file_name: str
    mime: str


# ---------- LIBRARY ----------


def load_library(sota_tag: str) -> List[Paper]:
    """
    Load every paper carrying SOTA tag, reusing already loaded papers

    Args:
        sota_tag (str): SOTA tag name
    Returns:
        List[Paper]: whole library
    """
    cached: Optional[Tuple[str, List[Paper]]] = st.session_state.get(LIBRARY_CACHE_KEY)
    if cached is not None and cached[0] == sota_tag:
        return cached[1]
    response = requests.get(f"{BACK_URL}/tag/{sota_tag}/files", timeout=REQUEST_TIMEOUT_SECONDS)
    paths: List[str] = response.json() if response.status_code == 200 else []
    loaded: Dict[str, Paper] = st.session_state.get("sota_papers", {})
    papers = [
        loaded.get(path) or Paper(path=path, info=load_paper_info(path))
        for path in stqdm(paths, desc="Loading library")
    ]
    st.session_state[LIBRARY_CACHE_KEY] = (sota_tag, papers)
    return papers


def forget_library() -> None:
    """
    Drop cached library and loaded search papers so both reload

    Args:
        None
    Returns:
        None
    """
    st.session_state.pop(LIBRARY_CACHE_KEY, None)
    st.session_state.pop("sota_loaded_for", None)


# ---------- EXPORT ----------


def export_entries(papers: List[Paper], include_pdfs: bool) -> Tuple[List[BibEntry], Dict[str, bytes]]:
    """
    Build bibliography entries and optional PDF payloads of papers

    Args:
        papers (List[Paper]): papers to export
        include_pdfs (bool): download PDFs and link them from entries
    Returns:
        Tuple[List[BibEntry], Dict[str, bytes]]: entries, PDF name -> content
    """
    entries: List[BibEntry] = []
    pdfs: Dict[str, bytes] = {}
    for paper in stqdm(papers, desc="Preparing export"):
        info = replace(paper.info, title=paper.display_title)
        if not include_pdfs:
            entries.append(BibEntry(info=info))
            continue
        name = paper.file_name if paper.file_name not in pdfs else f"{paper.upload_date}_{paper.file_name}"
        pdfs[name] = download_paper(paper.path)
        entries.append(BibEntry(info=info, attachment=name))
    return entries, pdfs


def build_export(papers: List[Paper], export_format: ExportFormat, include_pdfs: bool) -> ExportFile:
    """
    Generate bibliography file, or zip with PDFs

    Args:
        papers (List[Paper]): papers to export
        export_format (ExportFormat): target format
        include_pdfs (bool): bundle PDFs in zip
    Returns:
        ExportFile: downloadable export
    Raises:
        requests.RequestException: when a PDF cannot be downloaded
    """
    entries, pdfs = export_entries(papers, include_pdfs)
    bibliography = export_format.formatter(entries)
    if not include_pdfs:
        return ExportFile(bibliography.encode(), export_format.file_name, export_format.mime)
    archive = build_zip(export_format.file_name, bibliography, pdfs)
    return ExportFile(archive, export_format.file_name.rsplit(".", 1)[0] + ".zip", "application/zip")


def default_scope(selected: List[Paper], shown: List[Paper]) -> str:
    """
    Pick narrowest non-empty export scope

    Args:
        selected (List[Paper]): selected papers
        shown (List[Paper]): papers shown in list
    Returns:
        str: scope identifier
    """
    if selected:
        return SCOPE_SELECTED
    return SCOPE_SHOWN if shown else SCOPE_LIBRARY


@st.dialog("📤 Export references")
def export_dialog(sota_tag: str, selected: List[Paper], shown: List[Paper]) -> None:
    """
    Show export options and download generated file

    Args:
        sota_tag (str): SOTA tag name
        selected (List[Paper]): selected papers
        shown (List[Paper]): papers shown in list
    Returns:
        None
    """
    scopes: Dict[str, Tuple[str, Optional[List[Paper]]]] = {
        SCOPE_SELECTED: (f"Selected papers ({len(selected)})", selected),
        SCOPE_SHOWN: (f"Papers shown in list ({len(shown)})", shown),
        SCOPE_LIBRARY: ("Whole library", None),
    }
    format_name = st.segmented_control("Format", list(EXPORT_FORMATS), default=next(iter(EXPORT_FORMATS)))
    scope = st.radio("References", list(scopes), index=list(scopes).index(default_scope(selected, shown)),
                     format_func=lambda s: scopes[s][0])
    include_pdfs = st.toggle("Include PDFs", help="Zip with PDFs in files/, linked so Zotero re-attaches them.")
    if st.button("Generate", icon=":material/build:", type="primary", use_container_width=True,
                 disabled=format_name is None):
        papers = scopes[scope][1]
        targets = papers if papers is not None else load_library(sota_tag)
        st.session_state[EXPORT_RESULT_KEY] = build_export(targets, EXPORT_FORMATS[format_name or ""], include_pdfs)
    result: Optional[ExportFile] = st.session_state.get(EXPORT_RESULT_KEY)
    if result is not None:
        st.download_button(f"Download {result.file_name}", data=result.data, file_name=result.file_name,
                           mime=result.mime, icon=":material/download:", use_container_width=True)


# ---------- IMPORT ----------


def uploaded_path(file_name: str, date: str) -> str:
    """
    Predict path backend gives to uploaded file

    Args:
        file_name (str): uploaded file name
        date (str): upload date folder
    Returns:
        str: stored file path
    """
    safe_name = file_name.replace("/", "_").replace("\\", "_").replace(":", "-").replace("?", "")
    return f"/shared/{date}/{UPLOAD_SUBDIRECTORY}/{safe_name}"


def upload_pdf(name: str, content: bytes, sota_tag: str, date: str) -> Optional[str]:
    """
    Upload PDF tagged with SOTA tag

    Args:
        name (str): file name
        content (bytes): PDF content
        sota_tag (str): SOTA tag name
        date (str): upload date folder
    Returns:
        Optional[str]: stored path, None on failure
    """
    response = requests.post(
        f"{BACK_URL}/files/upload",
        params={"subdirectory": UPLOAD_SUBDIRECTORY, "date": date, "tags": json.dumps([sota_tag])},
        files=[("files", (name, content, "application/pdf"))],
        timeout=UPLOAD_TIMEOUT_SECONDS,
    )
    return uploaded_path(name, date) if response.status_code == 200 else None


def apply_plan_item(
    item: ImportPlanItem, pdfs: Dict[str, bytes], sota_tag: str, mark_validated: bool
) -> Optional[Paper]:
    """
    Update matched paper or upload new PDF with imported metadata

    Args:
        item (ImportPlanItem): planned action
        pdfs (Dict[str, bytes]): uploaded PDFs by name
        sota_tag (str): SOTA tag name
        mark_validated (bool): flag imported references as validated
    Returns:
        Optional[Paper]: saved paper, None on failure
    """
    if item.existing is not None:
        paper = item.existing
        paper.info = merge_info(paper.info, item.entry.info)
    else:
        path = upload_pdf(item.pdf_name, pdfs[item.pdf_name], sota_tag, datetime.datetime.now().astimezone().date().isoformat())
        if path is None:
            return None
        paper = Paper(path=path, info=replace(item.entry.info))
    paper.info.validated = mark_validated or paper.info.validated
    return paper if save_paper_info(paper) else None


def run_import(plan: List[ImportPlanItem], pdfs: Dict[str, bytes], sota_tag: str, mark_validated: bool) -> None:
    """
    Apply every actionable plan item and queue summary toast

    Args:
        plan (List[ImportPlanItem]): import plan
        pdfs (Dict[str, bytes]): uploaded PDFs by name
        sota_tag (str): SOTA tag name
        mark_validated (bool): flag imported references as validated
    Returns:
        None
    """
    actionable = [item for item in plan if item.action != "skip"]
    failed: List[str] = []
    shown_files: List[str] = st.session_state.get("sota_files", {}).get("files", [])
    for item in stqdm(actionable, desc="Importing references"):
        paper = apply_plan_item(item, pdfs, sota_tag, mark_validated)
        if paper is None:
            failed.append(item.entry.info.title)
        elif paper.path not in shown_files:
            shown_files.append(paper.path)
    forget_library()
    toast_for_rerun(f"{len(actionable) - len(failed)} reference(s) imported.", "📥")
    if failed:
        toast_for_rerun(f"Import failed for: {', '.join(failed)}", "⚠️")


def render_import_plan(plan: List[ImportPlanItem]) -> None:
    """
    Show planned action of each imported entry

    Args:
        plan (List[ImportPlanItem]): import plan
    Returns:
        None
    """
    counts = {action: sum(i.action == action for i in plan) for action in ACTION_BADGES}
    st.markdown(" &nbsp; ".join(f"{ACTION_BADGES[a]} **{n}**" for a, n in counts.items()))
    with st.container(height=260):
        for item in plan:
            detail = {
                "update": f"existing file {item.existing.file_name}" if item.existing else "",
                "add": f"new file {item.pdf_name}",
                "skip": "no matching paper and no PDF provided",
            }[item.action]
            st.markdown(f"{ACTION_BADGES[item.action]} {item.entry.info.title}  \n:gray[{detail}]")


@st.dialog("📥 Import references", width="large")
def import_dialog(sota_tag: str) -> None:
    """
    Import BibTeX / RIS (Zotero) bibliography with optional PDFs

    Args:
        sota_tag (str): SOTA tag name
    Returns:
        None
    """
    st.caption(ZOTERO_HELP)
    uploads = st.file_uploader("Bibliography (.bib, .ris), zip export, or PDFs", type=["bib", "ris", "zip", "pdf"],
                               accept_multiple_files=True)
    if not uploads:
        return
    try:
        sources = collect_sources([(u.name, u.getvalue()) for u in uploads])
    except zipfile.BadZipFile:
        st.error("Could not read the zip archive.")
        return
    entries = parse_sources(sources)
    if not entries:
        st.warning("No reference found. Add a .bib or .ris file (PDFs alone carry no bibliography).")
        return
    plan = plan_import(entries, load_library(sota_tag), set(sources.pdfs))
    render_import_plan(plan)
    st.caption("Matched papers keep their file; non-empty imported fields replace current ones.")
    mark_validated = st.toggle("Mark imported references as validated", value=True)
    actionable_count = sum(item.action != "skip" for item in plan)
    if st.button(f"Import {actionable_count} reference(s)", icon=":material/download:", type="primary",
                 use_container_width=True, disabled=actionable_count == 0):
        run_import(plan, sources.pdfs, sota_tag, mark_validated)
        st.rerun()


def render_transfer_buttons(sota_tag: str, selected: List[Paper], shown: List[Paper]) -> None:
    """
    Render sidebar Export and Import buttons

    Args:
        sota_tag (str): SOTA tag name
        selected (List[Paper]): selected papers
        shown (List[Paper]): papers shown in list
    Returns:
        None
    """
    if st.sidebar.button("Export", icon=":material/upload:", use_container_width=True):
        st.session_state.pop(EXPORT_RESULT_KEY, None)
        export_dialog(sota_tag, selected, shown)
    if st.sidebar.button("Import", icon=":material/download:", use_container_width=True):
        import_dialog(sota_tag)

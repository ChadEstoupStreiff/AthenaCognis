from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests
import streamlit as st
from stqdm import stqdm

from core.bibliography import bibtex_citations
from core.explorer import (
    generate_query_description,
    run_streaming_search,
    search_engine,
)
from core.library_transfer import render_transfer_buttons
from core.reference_lookup import fetch_online_info
from core.relation_map import render_relation_map
from core.stateoftheart import (
    BACK_URL,
    REQUEST_TIMEOUT_SECONDS,
    SORT_OPTIONS,
    STATUS_ALL,
    STATUS_BADGES,
    STATUS_FILTERS,
    STATUS_MISSING,
    STATUS_TO_REVIEW,
    STATUS_VALIDATED,
    Paper,
    PaperInfo,
    filter_papers,
    format_APA,
    format_Vancouver,
    load_paper_info,
    save_paper_info,
    short_authors,
)
from pages import PAGE_VIEWER
from utils import toast_for_rerun

SELECTION_PREFIX = "sota_sel::"
TAB_LABELS = [":material/library_books: Library", ":material/hub: Citation & Relation Map", ":material/radar: Literature Watch"]
MARKDOWN_SPECIAL_CHARS = "\\`*_[]$~<>#|"


@dataclass(frozen=True)
class CitationStyle:
    """Citation export format."""

    formatter: Callable[[List[Dict[str, Any]]], str]
    language: Optional[str]
    file_name: str


CITATION_STYLES: Dict[str, CitationStyle] = {
    "APA": CitationStyle(format_APA, None, "references_apa.txt"),
    "Vancouver": CitationStyle(format_Vancouver, None, "references_vancouver.txt"),
    "BibTeX": CitationStyle(bibtex_citations, "latex", "references.bib"),
}


def escape_markdown(text: str) -> str:
    """
    Escape characters Streamlit markdown would interpret

    Args:
        text (str): raw text
    Returns:
        str: escaped text
    """
    return "".join(f"\\{c}" if c in MARKDOWN_SPECIAL_CHARS else c for c in text)


def selection_key(paper: Paper) -> str:
    """
    Return session-state key of paper selection checkbox

    Args:
        paper (Paper): paper
    Returns:
        str: widget key
    """
    return f"{SELECTION_PREFIX}{paper.path}"


def ensure_papers_loaded(files: List[str]) -> List[Paper]:
    """
    Load metadata of found files once per search result

    Args:
        files (List[str]): file paths of search result
    Returns:
        List[Paper]: papers with metadata
    """
    if st.session_state.get("sota_loaded_for") != files:
        st.session_state.sota_papers = {
            path: Paper(path=path, info=load_paper_info(path))
            for path in stqdm(files, desc="Loading references")
        }
        st.session_state.sota_loaded_for = list(files)
    papers: Dict[str, Paper] = st.session_state.sota_papers
    return list(papers.values())


def selected_papers(papers: List[Paper]) -> List[Paper]:
    """
    Return papers whose checkbox is ticked

    Args:
        papers (List[Paper]): candidate papers
    Returns:
        List[Paper]: selected papers
    """
    return [p for p in papers if st.session_state.get(selection_key(p), False)]


def set_selection(papers: List[Paper], is_selected: bool) -> None:
    """
    Tick or untick selection checkbox of papers

    Args:
        papers (List[Paper]): papers to update
        is_selected (bool): new checkbox value
    Returns:
        None
    """
    for paper in papers:
        st.session_state[selection_key(paper)] = is_selected


def persist_papers(papers: List[Paper], success_message: str) -> None:
    """
    Save papers metadata and queue result toast

    Args:
        papers (List[Paper]): papers to save
        success_message (str): toast shown when all saves succeed
    Returns:
        None
    """
    failed = [p.file_name for p in papers if not save_paper_info(p)]
    if failed:
        toast_for_rerun(f"Could not save: {', '.join(failed)}", "⚠️")
        return
    toast_for_rerun(success_message, "✅")


def set_validated(papers: List[Paper], is_validated: bool) -> None:
    """
    Mark papers as validated or not and save them

    Args:
        papers (List[Paper]): papers to update
        is_validated (bool): new validation flag
    Returns:
        None
    """
    for paper in papers:
        paper.info.validated = is_validated
    label = "validated" if is_validated else "marked to review"
    persist_papers(papers, f"{len(papers)} paper(s) {label}.")


def find_online_info(papers: List[Paper]) -> None:
    """
    Fill papers metadata from arXiv / PubMed / CrossRef and save them

    Args:
        papers (List[Paper]): papers to look up
    Returns:
        None
    """
    found: List[Paper] = []
    missing: List[str] = []
    for paper in stqdm(papers, desc="Searching references online"):
        info = fetch_online_info(paper)
        if info is None:
            missing.append(paper.file_name)
            continue
        paper.info = info
        found.append(paper)
    if found:
        persist_papers(found, f"Metadata found for {len(found)} paper(s).")
    if missing:
        toast_for_rerun(f"Nothing found for: {', '.join(missing)}", "🔍")


def open_paper(paper: Paper) -> None:
    """
    Open paper file in document viewer

    Args:
        paper (Paper): paper to open
    Returns:
        None
    """
    st.session_state.file_to_see = paper.path
    st.switch_page(PAGE_VIEWER)


@st.dialog("✏️ Edit reference", width="large")
def edit_paper_dialog(paper: Paper) -> None:
    """
    Show form editing metadata of one paper

    Args:
        paper (Paper): paper to edit
    Returns:
        None
    """
    info = paper.info
    st.caption(f"📄 {paper.file_name} · added {paper.upload_date}")
    with st.form(f"sota_edit_{paper.path}", border=False):
        title = st.text_input("Title", value=info.title)
        authors = st.text_input(
            "Authors", value=info.authors, help="Separate authors with `|`, e.g. `Doe, John | Smith, Ann`"
        )
        year_col, journal_col = st.columns([1, 3])
        year = year_col.text_input("Year", value=info.year)
        journal = journal_col.text_input("Journal", value=info.journal)
        volume_col, issue_col, pages_col = st.columns(3)
        volume = volume_col.text_input("Volume", value=info.volume)
        issue = issue_col.text_input("Issue", value=info.issue)
        pages = pages_col.text_input("Pages", value=info.pages)
        doi_col, url_col = st.columns(2)
        doi = doi_col.text_input("DOI", value=info.doi)
        url = url_col.text_input("URL", value=info.url)
        save_col, validate_col = st.columns(2)
        is_saved = save_col.form_submit_button("Save", icon=":material/save:", use_container_width=True)
        is_validated = validate_col.form_submit_button(
            "Save & validate", icon=":material/verified:", type="primary", use_container_width=True
        )
    if not (is_saved or is_validated):
        return
    paper.info = PaperInfo(
        title=title, authors=authors, year=year, journal=journal, url=url, doi=doi,
        volume=volume, issue=issue, pages=pages, source=info.source,
        validated=is_validated or info.validated,
    )
    persist_papers([paper], "Reference saved.")
    st.rerun()


@st.dialog("📚 Export citations", width="large")
def citation_dialog(papers: List[Paper]) -> None:
    """
    Show papers formatted in every citation style

    Args:
        papers (List[Paper]): papers to cite
    Returns:
        None
    """
    st.caption(f"{len(papers)} reference(s)")
    references = [p.info.to_dict() for p in papers]
    for tab, (style_name, style) in zip(st.tabs(list(CITATION_STYLES)), CITATION_STYLES.items()):
        with tab:
            text = style.formatter(references)
            st.code(text, language=style.language, wrap_lines=True)
            st.download_button(
                f"Download {style_name}",
                data=text,
                file_name=style.file_name,
                icon=":material/download:",
                use_container_width=True,
                key=f"sota_download_{style_name}",
            )


def on_sota_tag_change() -> None:
    """
    Save chosen SOTA tag and drop previous search result

    Args:
        None
    Returns:
        None
    """
    selected_tag = st.session_state.sota_tag_selection
    if selected_tag is None:
        requests.delete(f"{BACK_URL}/stockpile/delete/sota_tag", timeout=REQUEST_TIMEOUT_SECONDS)
    else:
        requests.post(
            f"{BACK_URL}/stockpile/set/sota_tag",
            params={"value": selected_tag},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    st.session_state.pop("sota_files", None)
    toast_for_rerun("SOTA tag updated.", "✅")


def render_sota_tag_selector() -> Optional[str]:
    """
    Render sidebar SOTA tag selector

    Args:
        None
    Returns:
        Optional[str]: current SOTA tag, None when unset
    """
    tags_name = [t["name"] for t in requests.get(f"{BACK_URL}/tags", timeout=REQUEST_TIMEOUT_SECONDS).json()]
    response = requests.get(f"{BACK_URL}/stockpile/get/sota_tag", timeout=REQUEST_TIMEOUT_SECONDS)
    sota_tag: Optional[str] = response.json() if response.status_code == 200 else None
    st.sidebar.selectbox(
        "SOTA Tag",
        options=tags_name,
        index=tags_name.index(sota_tag) if sota_tag in tags_name else None,
        on_change=on_sota_tag_change,
        key="sota_tag_selection",
        help="Tag marking your State-of-the-art papers.",
    )
    return sota_tag


def render_search(sota_tag: str) -> None:
    """
    Render collapsible search form restricted to SOTA tag

    Args:
        sota_tag (str): SOTA tag forced in search
    Returns:
        None
    """
    has_results = "sota_files" in st.session_state
    with st.expander("Search library", icon=":material/search:", expanded=not has_results):
        search_params = search_engine(force_tags=[sota_tag], streaming=True)
    if search_params is not None:
        st.session_state.sota_files = run_streaming_search(search_params)
    if "sota_files" in st.session_state:
        st.caption(generate_query_description(st.session_state.sota_files))


def render_progress(papers: List[Paper]) -> None:
    """
    Render validation progress bar

    Args:
        papers (List[Paper]): all papers
    Returns:
        None
    """
    counts = {s: sum(p.status == s for p in papers) for s in STATUS_BADGES}
    st.progress(
        counts[STATUS_VALIDATED] / len(papers),
        text=f"**{counts[STATUS_VALIDATED]} / {len(papers)}** references validated · "
        f"{counts[STATUS_TO_REVIEW]} to review · {counts[STATUS_MISSING]} missing info",
    )


def render_toolbar() -> Tuple[str, str, str]:
    """
    Render status filter, text filter and sort selector

    Args:
        None
    Returns:
        Tuple[str, str, str]: status filter, text query, sort option
    """
    status_col, query_col, sort_col = st.columns([3, 2, 1], vertical_alignment="bottom")
    status = status_col.segmented_control(
        "Status", options=STATUS_FILTERS, default=STATUS_ALL, key="sota_status_filter",
        label_visibility="collapsed",
    )
    query = query_col.text_input(
        "Filter", placeholder="Filter by title, author, journal…", key="sota_query",
        label_visibility="collapsed",
    )
    sort = sort_col.selectbox(
        "Sort", options=list(SORT_OPTIONS), key="sota_sort", label_visibility="collapsed"
    )
    return status or STATUS_ALL, query, sort


def render_bulk_bar(visible: List[Paper], selected: List[Paper]) -> None:
    """
    Render selection summary and bulk actions

    Args:
        visible (List[Paper]): papers matching current filters
        selected (List[Paper]): selected papers
    Returns:
        None
    """
    has_selection = bool(selected)
    cite_targets = selected if has_selection else visible
    lookup_targets = [p for p in selected if not p.info.validated]
    with st.container(border=True):
        cols = st.columns([2, 1, 1, 1, 1, 1], vertical_alignment="center")
        cols[0].markdown(f"**{len(selected)}** selected · {len(visible)} shown")
        if has_selection:
            cols[1].button("Clear", icon=":material/deselect:", on_click=set_selection,
                           args=(selected, False), use_container_width=True, type="tertiary")
        else:
            cols[1].button("Select all", icon=":material/select_all:", on_click=set_selection,
                           args=(visible, True), use_container_width=True, type="tertiary")
        is_finding = cols[2].button("Find info", icon=":material/travel_explore:", disabled=not lookup_targets,
                                    use_container_width=True,
                                    help="Read PDF header with GROBID, then match on CrossRef, PubMed and arXiv. "
                                    "Validated papers are skipped.")
        cols[3].button("Validate", icon=":material/verified:", on_click=set_validated, args=(selected, True),
                       disabled=not has_selection, use_container_width=True)
        cols[4].button("Unvalidate", icon=":material/undo:", on_click=set_validated, args=(selected, False),
                       disabled=not has_selection, use_container_width=True)
        is_citing = cols[5].button("Cite" if has_selection else "Cite all", icon=":material/format_quote:",
                                   type="primary", disabled=not cite_targets, use_container_width=True)
    if is_finding:
        find_online_info(lookup_targets)
        st.rerun()
    if is_citing:
        citation_dialog(cite_targets)


def reference_line(paper: Paper) -> str:
    """
    Build "authors · year · journal" caption of paper

    Args:
        paper (Paper): paper
    Returns:
        str: escaped markdown line
    """
    parts = [short_authors(paper.info.authors), paper.info.year, paper.info.journal]
    details = [escape_markdown(p.strip()) for p in parts if p and p.strip()]
    return " · ".join(details) if details else "_No reference information yet_"


def links_line(paper: Paper) -> str:
    """
    Build status badge and external links line

    Args:
        paper (Paper): paper
    Returns:
        str: markdown line
    """
    items = [STATUS_BADGES[paper.status]]
    if paper.info.doi:
        items.append(f"[:material/link: DOI](https://doi.org/{paper.info.doi})")
    if paper.info.url:
        items.append(f"[:material/open_in_new: Publication]({paper.info.url})")
    items.append(f":gray[:material/description: {escape_markdown(paper.file_name)}]")
    if paper.info.source:
        items.append(f":gray[:material/database: {escape_markdown(paper.info.source)}]")
    return " &nbsp; ".join(items)


def label_badges(paper: Paper) -> List[str]:
    """
    Fetch projects and tags of paper as markdown badges

    Args:
        paper (Paper): paper
    Returns:
        List[str]: project badges followed by tag badges
    """
    projects = requests.get(f"{BACK_URL}/projects_of/{paper.path}", timeout=REQUEST_TIMEOUT_SECONDS).json()
    tags = requests.get(f"{BACK_URL}/tags_of/{paper.path}", timeout=REQUEST_TIMEOUT_SECONDS).json()
    return [f":blue-badge[{escape_markdown(p['name'])}]" for p in projects] + [
        f":violet-badge[{escape_markdown(t['name'])}]" for t in tags
    ]


def render_card_actions(paper: Paper) -> None:
    """
    Render open / edit / lookup / validate icon buttons of card, no lookup once validated

    Args:
        paper (Paper): paper
    Returns:
        None
    """
    open_col, edit_col, find_col, validate_col = st.columns(4)
    key = paper.path
    if open_col.button("", icon=":material/visibility:", key=f"sota_open_{key}", type="tertiary", help="Open document"):
        open_paper(paper)
    if edit_col.button("", icon=":material/edit:", key=f"sota_edit_{key}", type="tertiary", help="Edit reference"):
        edit_paper_dialog(paper)
    is_validated = paper.info.validated
    if not is_validated and find_col.button(
        "", icon=":material/travel_explore:", key=f"sota_find_{key}", type="tertiary", help="Find reference online"
    ):
        find_online_info([paper])
        st.rerun()
    validate_col.button(
        "", icon=":material/undo:" if is_validated else ":material/check_circle:", key=f"sota_validate_{key}",
        type="tertiary", on_click=set_validated, args=([paper], not is_validated),
        help="Mark to review" if is_validated else "Validate reference",
    )


def render_paper_card(paper: Paper, show_labels: bool) -> None:
    """
    Render one paper as bordered card

    Args:
        paper (Paper): paper
        show_labels (bool): show projects and tags badges
    Returns:
        None
    """
    with st.container(border=True):
        check_col, body_col, actions_col = st.columns([0.04, 0.74, 0.22], vertical_alignment="center")
        check_col.checkbox("Select", key=selection_key(paper), label_visibility="collapsed")
        with body_col:
            st.markdown(f"**{escape_markdown(paper.display_title)}**  \n:gray[{reference_line(paper)}]")
            labels = label_badges(paper) if show_labels else []
            st.markdown("  \n".join([links_line(paper), " &nbsp; ".join(labels)] if labels else [links_line(paper)]))
        with actions_col:
            render_card_actions(paper)


def render_library(papers: List[Paper], show_labels: bool) -> Tuple[List[Paper], List[Paper]]:
    """
    Render progress, toolbar, bulk actions and paper cards

    Args:
        papers (List[Paper]): all papers
        show_labels (bool): show projects and tags badges on cards
    Returns:
        Tuple[List[Paper], List[Paper]]: selected papers, papers shown
    """
    render_progress(papers)
    status, query, sort = render_toolbar()
    visible = SORT_OPTIONS[sort](filter_papers(papers, status, query))
    selected = selected_papers(papers)
    render_bulk_bar(visible, selected)
    if not visible:
        st.info("No reference matches these filters.", icon=":material/filter_alt_off:")
    for paper in visible:
        render_paper_card(paper, show_labels)
    return selected, visible


def search_papers() -> List[Paper]:
    """
    Return papers of current search, empty before any search

    Args:
        None
    Returns:
        List[Paper]: papers with metadata
    """
    if "sota_files" not in st.session_state:
        return []
    return ensure_papers_loaded(st.session_state.sota_files["files"])


def render_results(papers: List[Paper], show_labels: bool) -> Tuple[List[Paper], List[Paper]]:
    """
    Render search results library, or hint when none

    Args:
        papers (List[Paper]): papers of current search
        show_labels (bool): show projects and tags badges on cards
    Returns:
        Tuple[List[Paper], List[Paper]]: selected papers, papers shown
    """
    if "sota_files" not in st.session_state:
        st.info("Search your library to list references.", icon=":material/search:")
        return [], []
    if not papers:
        st.info("No file found with this tag.", icon=":material/inbox:")
        return [], []
    return render_library(papers, show_labels)


def stateoftheart() -> None:
    """
    Render State-of-the-art page

    Args:
        None
    Returns:
        None
    """
    sota_tag = render_sota_tag_selector()
    show_labels = st.sidebar.toggle("Show projects & tags", value=True)
    if sota_tag is None:
        st.warning("Pick the tag marking your State-of-the-art papers in the sidebar.", icon=":material/sell:")
        return
    render_search(sota_tag)
    papers = search_papers()
    library_tab, relation_map_tab, watch_tab = st.tabs(TAB_LABELS)
    with library_tab:
        selected, shown = render_results(papers, show_labels)
    with relation_map_tab:
        render_relation_map(papers, selected)
    with watch_tab:
        st.info("Coming soon.", icon=":material/construction:")
    render_transfer_buttons(sota_tag, selected, shown)


if __name__ == "__main__":
    stateoftheart()

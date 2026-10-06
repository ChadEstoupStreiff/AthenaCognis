from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

import requests
import streamlit as st
from stqdm import stqdm
from streamlit_agraph import Config, Edge, Node, agraph

from core.citations import (
    CitationRecord,
    ExternalWork,
    analyze_paper,
    citation_edges,
    fetch_external_works,
    load_citation_record,
    neighborhood,
    save_citation_record,
    shared_references,
)
from core.reference_lookup import LOOKUP_ERRORS
from core.stateoftheart import (
    BACK_URL,
    REQUEST_TIMEOUT_SECONDS,
    STATUS_BADGES,
    Paper,
    short_authors,
)
from pages import PAGE_VIEWER
from utils import toast_for_rerun

MODE_CITATIONS = "Citations"
MODE_AI = "AI relations"
GRAPH_WIDTH = 1050
GRAPH_HEIGHT = 620
LIBRARY_COLOR = "#2e9e5b"
FOCUS_COLOR = "#d9480f"
EXTERNAL_COLOR = "#8a9bb5"
BASE_NODE_SIZE = 14
SIZE_PER_CONNECTION = 3
MAX_NODE_SIZE = 40
LABEL_TITLE_LENGTH = 24
MAX_SHARED_REFERENCES = 40
AI_LINK_TIMEOUT_SECONDS = 600
MAX_AI_FORCE = 3.0
MAX_FOCUS_DEPTH = 4
KIND_CITATION = "citation"
KIND_AI = "ai"
MODE_CAPTIONS: Dict[str, str] = {
    "Citations": "{papers} papers · {shared} shared reference(s) outside library (grey) · {count} citation(s) · "
    "arrow = cites",
    "AI relations": "{papers} papers · {count} AI relation(s) · line width = strength · hover a line for the reason",
}
RECORDS_KEY = "sota_citation_records"
EXTERNAL_KEY = "sota_external_works"
AI_LINKS_KEY = "sota_ai_links"


@dataclass
class AiLink:
    """Undirected AI relation between two files."""

    file_a: str
    file_b: str
    force: float
    comment: str


# ---------- DATA ----------


def load_records(papers: List[Paper]) -> Dict[str, CitationRecord]:
    """
    Return citation records of papers, loading missing ones once

    Args:
        papers (List[Paper]): papers
    Returns:
        Dict[str, CitationRecord]: path -> record, analyzed papers only
    """
    cache: Dict[str, Optional[CitationRecord]] = st.session_state.setdefault(RECORDS_KEY, {})
    for paper in papers:
        if paper.path not in cache:
            cache[paper.path] = load_citation_record(paper)
    return {p.path: record for p in papers if (record := cache.get(p.path)) is not None}


def analyze_citations(papers: List[Paper]) -> None:
    """
    Find and store references of papers

    Args:
        papers (List[Paper]): papers to analyze
    Returns:
        None
    """
    cache: Dict[str, Optional[CitationRecord]] = st.session_state.setdefault(RECORDS_KEY, {})
    failed = []
    for paper in stqdm(papers, desc="Finding references"):
        record = analyze_paper(paper)
        cache[paper.path] = record
        if not save_citation_record(paper, record):
            failed.append(paper.file_name)
    st.session_state.pop(EXTERNAL_KEY, None)
    found = sum(1 for p in papers if (record := cache.get(p.path)) is not None and record.references)
    toast_for_rerun(f"References found for {found} / {len(papers)} paper(s).", "🕸️")
    if failed:
        toast_for_rerun(f"Could not save: {', '.join(failed)}", "⚠️")


def load_external_works(counts: Dict[str, int]) -> Dict[str, ExternalWork]:
    """
    Return metadata of shared external references, fetched once per id set

    Args:
        counts (Dict[str, int]): OpenAlex id -> citing library papers
    Returns:
        Dict[str, ExternalWork]: OpenAlex id -> work
    """
    cached: Optional[Tuple[frozenset[str], Dict[str, ExternalWork]]] = st.session_state.get(EXTERNAL_KEY)
    if cached is not None and cached[0] == frozenset(counts):
        return cached[1]
    try:
        works = {w.openalex_id: w for w in fetch_external_works(counts)}
    except LOOKUP_ERRORS as error:
        st.warning(f"Could not load shared references from OpenAlex: {error}")
        return {}
    st.session_state[EXTERNAL_KEY] = (frozenset(counts), works)
    return works


def load_ai_links(papers: List[Paper]) -> List[AiLink]:
    """
    Return AI relations between papers, fetched once per paper set

    Args:
        papers (List[Paper]): papers
    Returns:
        List[AiLink]: links with both ends in papers
    """
    paths = frozenset(p.path for p in papers)
    cached: Optional[Tuple[frozenset[str], List[AiLink]]] = st.session_state.get(AI_LINKS_KEY)
    if cached is not None and cached[0] == paths:
        return cached[1]
    links: Dict[Tuple[str, str], AiLink] = {}
    for path in paths:
        response = requests.get(f"{BACK_URL}/links/list/{path}", timeout=REQUEST_TIMEOUT_SECONDS)
        for other, force, comment in response.json() if response.status_code == 200 else []:
            pair = (min(path, other), max(path, other))
            if other in paths and pair not in links:
                links[pair] = AiLink(pair[0], pair[1], float(force), comment or "")
    st.session_state[AI_LINKS_KEY] = (paths, list(links.values()))
    return list(links.values())


def find_ai_relations(sources: List[Paper], papers: List[Paper], min_force: float) -> None:
    """
    Ask AI for relations between sources and other papers, store strong ones

    Args:
        sources (List[Paper]): papers to analyze
        papers (List[Paper]): candidate related papers
        min_force (float): minimum strength kept (0-3)
    Returns:
        None
    """
    linked = {frozenset((link.file_a, link.file_b)) for link in load_ai_links(papers)}
    added = 0
    for source in stqdm(sources, desc="Asking AI for relations"):
        targets = [p.path for p in papers if p.path != source.path and frozenset((source.path, p.path)) not in linked]
        if not targets:
            continue
        response = requests.post(f"{BACK_URL}/links/auto-find", json={"source_file": source.path,
                                 "target_files": targets}, timeout=AI_LINK_TIMEOUT_SECONDS)
        if response.status_code != 200:
            toast_for_rerun(f"AI failed for {source.file_name}: {response.text[:120]}", "⚠️")
            continue
        for link in response.json():
            if link["force"] >= min_force and add_ai_link(link):
                linked.add(frozenset((link["fileA"], link["fileB"])))
                added += 1
    st.session_state.pop(AI_LINKS_KEY, None)
    toast_for_rerun(f"{added} AI relation(s) added.", "🤖")


def add_ai_link(link: Dict[str, str | float]) -> bool:
    """
    Store AI link suggestion

    Args:
        link (Dict[str, str | float]): fileA, fileB, force, comment
    Returns:
        bool: True on success
    """
    response = requests.post(f"{BACK_URL}/links/add", params=link, timeout=REQUEST_TIMEOUT_SECONDS)
    return response.status_code == 200


# ---------- GRAPH ----------


@dataclass
class GraphLink:
    """Edge of map: citation (source cites target) or AI relation."""

    source: str
    target: str
    kind: str
    force: float = 0.0
    comment: str = ""


@dataclass
class MapView:
    """Display options of map."""

    mode: str
    focus: Optional[str]
    depth: int
    timeline: bool
    hide_unconnected: bool


def paper_label(paper: Paper) -> str:
    """
    Build short node label "Author Year", or truncated title

    Args:
        paper (Paper): paper
    Returns:
        str: label
    """
    author = paper.info.authors.split("|")[0].split(",")[0].strip()
    if author:
        return f"{author} {paper.info.year}".strip()
    title = paper.display_title
    return title if len(title) <= LABEL_TITLE_LENGTH else f"{title[:LABEL_TITLE_LENGTH]}…"


def node_size(connections: int) -> int:
    """
    Scale node size with number of connections

    Args:
        connections (int): edges touching node
    Returns:
        int: node size
    """
    return min(MAX_NODE_SIZE, BASE_NODE_SIZE + SIZE_PER_CONNECTION * connections)


def year_levels(years: List[str]) -> Dict[str, int]:
    """
    Map each year to timeline column, unknown years first

    Args:
        years (List[str]): years of nodes
    Returns:
        Dict[str, int]: year -> level
    """
    return {year: level for level, year in enumerate(sorted(set(years), key=lambda y: (y != "", y)))}


def degrees_of(links: List[GraphLink]) -> Dict[str, int]:
    """
    Count links touching each node

    Args:
        links (List[GraphLink]): links
    Returns:
        Dict[str, int]: node id -> connections
    """
    degrees: Dict[str, int] = {}
    for link in links:
        degrees[link.source] = degrees.get(link.source, 0) + 1
        degrees[link.target] = degrees.get(link.target, 0) + 1
    return degrees


def make_nodes(
    papers: List[Paper], externals: List[ExternalWork], degrees: Dict[str, int], view: MapView
) -> List[Node]:
    """
    Build graph nodes of library papers and external works, focus highlighted

    Args:
        papers (List[Paper]): library papers to draw
        externals (List[ExternalWork]): external works to draw
        degrees (Dict[str, int]): node id -> connections
        view (MapView): display options
    Returns:
        List[Node]: nodes
    """
    levels = year_levels([p.info.year for p in papers] + [w.year for w in externals])
    nodes = []
    for paper in papers:
        is_focus = paper.path == view.focus
        extra = {"level": levels[paper.info.year]} if view.timeline else {}
        nodes.append(Node(id=paper.path, label=paper_label(paper), title=paper.display_title,
                          size=MAX_NODE_SIZE if is_focus else node_size(degrees.get(paper.path, 0)),
                          color=FOCUS_COLOR if is_focus else LIBRARY_COLOR, **extra))
    for work in externals:
        extra = {"level": levels[work.year]} if view.timeline else {}
        tooltip = f"{work.title}\nCited by {work.library_citations} of your papers"
        nodes.append(Node(id=work.openalex_id, label=f"{work.first_author} {work.year}".strip(), title=tooltip,
                          size=node_size(work.library_citations), color=EXTERNAL_COLOR, **extra))
    return nodes


def make_edges(links: List[GraphLink]) -> List[Edge]:
    """
    Build graph edges, AI width and tooltip reflecting strength

    Args:
        links (List[GraphLink]): links to draw
    Returns:
        List[Edge]: edges
    """
    edges = []
    for link in links:
        if link.kind == KIND_AI:
            tooltip = f"Strength {link.force:.1f} / {MAX_AI_FORCE:.0f} — {link.comment}"
            edges.append(Edge(source=link.source, target=link.target, width=1 + link.force, title=tooltip))
        else:
            edges.append(Edge(source=link.source, target=link.target, title="cites"))
    return edges


def visible_nodes(node_ids: List[str], links: List[GraphLink], view: MapView) -> Set[str]:
    """
    Apply focus neighborhood and unconnected filter

    Args:
        node_ids (List[str]): every node id
        links (List[GraphLink]): drawn links
        view (MapView): display options
    Returns:
        Set[str]: node ids to draw
    """
    visible = set(node_ids)
    if view.focus is not None:
        visible &= neighborhood([(link.source, link.target) for link in links], view.focus, view.depth)
    if view.hide_unconnected:
        connected = set(degrees_of(links))
        visible = {n for n in visible if n in connected or n == view.focus}
    return visible


def draw_graph(nodes: List[Node], edges: List[Edge], view: MapView) -> Optional[str]:
    """
    Draw interactive graph

    Args:
        nodes (List[Node]): nodes
        edges (List[Edge]): edges
        view (MapView): display options
    Returns:
        Optional[str]: id of clicked node
    """
    config = Config(width=GRAPH_WIDTH, height=GRAPH_HEIGHT, directed=view.mode == MODE_CITATIONS,
                    physics=not view.timeline, hierarchical=view.timeline, direction="LR",
                    levelSeparation=220, nodeSpacing=60)
    return agraph(nodes=nodes, edges=edges, config=config)


# ---------- LINKS ----------


def citation_links(
    papers: List[Paper], records: Dict[str, CitationRecord], externals: Dict[str, ExternalWork]
) -> List[GraphLink]:
    """
    Build citation links inside library and towards shown external works

    Args:
        papers (List[Paper]): library papers
        records (Dict[str, CitationRecord]): path -> record
        externals (Dict[str, ExternalWork]): external works shown
    Returns:
        List[GraphLink]: citation links
    """
    edges, _ = citation_edges(papers, records)
    links = [GraphLink(e.citing, e.cited, KIND_CITATION) for e in edges]
    for paper in papers:
        references = set(records.get(paper.path, CitationRecord()).references)
        links += [GraphLink(paper.path, work, KIND_CITATION) for work in externals if work in references]
    return links


def shared_externals(papers: List[Paper], records: Dict[str, CitationRecord], min_citing: int) -> Dict[str, ExternalWork]:
    """
    Load external works cited by at least min_citing library papers

    Args:
        papers (List[Paper]): library papers
        records (Dict[str, CitationRecord]): path -> record
        min_citing (int): minimum citing papers
    Returns:
        Dict[str, ExternalWork]: OpenAlex id -> work
    """
    _, external_counts = citation_edges(papers, records)
    shared = shared_references(external_counts, min_citing, MAX_SHARED_REFERENCES)
    return load_external_works(shared) if shared else {}


def ai_graph_links(papers: List[Paper]) -> List[GraphLink]:
    """
    Convert stored AI relations into links

    Args:
        papers (List[Paper]): library papers
    Returns:
        List[GraphLink]: AI links
    """
    return [GraphLink(link.file_a, link.file_b, KIND_AI, link.force, link.comment) for link in load_ai_links(papers)]


# ---------- DETAILS ----------


def connection_line(link: GraphLink, node_id: str, title_of: Dict[str, str]) -> str:
    """
    Describe one connection of node as markdown

    Args:
        link (GraphLink): link touching node
        node_id (str): described node
        title_of (Dict[str, str]): node id -> title
    Returns:
        str: markdown line with type badge
    """
    other = link.target if link.source == node_id else link.source
    title = title_of.get(other, other)
    if link.kind == KIND_AI:
        comment = f"  \n&nbsp;&nbsp;&nbsp;:gray[{link.comment}]" if link.comment else ""
        return f":orange-badge[:material/auto_awesome: AI link · strength {link.force:.1f} / {MAX_AI_FORCE:.0f}] {title}{comment}"
    if link.source == node_id:
        return f":blue-badge[:material/north_east: Cites] {title}"
    return f":violet-badge[:material/south_west: Cited by] {title}"


def connection_lines(node_id: str, links: List[GraphLink], title_of: Dict[str, str]) -> List[str]:
    """
    Describe every connection of node: citations first, then AI links by strength

    Args:
        node_id (str): described node
        links (List[GraphLink]): all links
        title_of (Dict[str, str]): node id -> title
    Returns:
        List[str]: markdown lines
    """
    touching = [link for link in links if node_id in (link.source, link.target)]
    touching.sort(key=lambda link: (link.kind == KIND_AI, link.source != node_id, -link.force))
    return [connection_line(link, node_id, title_of) for link in touching]


def paper_facts(paper: Paper, record: Optional[CitationRecord]) -> str:
    """
    Build status, identifiers and citation statistics line of paper

    Args:
        paper (Paper): paper
        record (Optional[CitationRecord]): its citation record
    Returns:
        str: markdown line
    """
    facts = [STATUS_BADGES[paper.status]]
    if paper.info.doi:
        facts.append(f"[DOI](https://doi.org/{paper.info.doi})")
    if record is not None and record.openalex_id:
        facts.append(f"[OpenAlex](https://openalex.org/{record.openalex_id})")
    if record is not None and record.source != "none":
        origin = f" ({record.source})" if record.source else ""
        facts.append(f"{record.cited_by_count} citations overall · {len(record.references)} references{origin}")
    return " &nbsp; ".join(facts)


def render_paper_details(
    paper: Paper, record: Optional[CitationRecord], lines: List[str], is_focus: bool
) -> None:
    """
    Show clicked library paper, facts and connections

    Args:
        paper (Paper): clicked paper
        record (Optional[CitationRecord]): its citation record
        lines (List[str]): connection lines
        is_focus (bool): paper already focused
    Returns:
        None
    """
    with st.container(border=True):
        details = " · ".join(x for x in (short_authors(paper.info.authors), paper.info.year, paper.info.journal) if x)
        st.markdown(f"**{paper.display_title}**  \n:gray[{details}]  \n{paper_facts(paper, record)}")
        st.markdown(f"**{len(lines)} connection(s)**  \n" + "  \n".join(lines) if lines else ":gray[No connection]")
        open_col, focus_col = st.columns(2)
        if open_col.button("Open document", icon=":material/visibility:", key="sota_map_open", use_container_width=True):
            st.session_state.file_to_see = paper.path
            st.switch_page(PAGE_VIEWER)
        focus_col.button("Focus on this paper", icon=":material/center_focus_strong:", disabled=is_focus,
                         use_container_width=True, on_click=lambda: st.session_state.update(sota_map_focus=paper.path))


def render_external_details(work: ExternalWork, lines: List[str]) -> None:
    """
    Show clicked external work and library papers citing it

    Args:
        work (ExternalWork): clicked work
        lines (List[str]): connection lines
    Returns:
        None
    """
    with st.container(border=True):
        links = [f"[OpenAlex](https://openalex.org/{work.openalex_id})"]
        if work.doi:
            links.insert(0, f"[DOI](https://doi.org/{work.doi})")
        st.markdown(f"**{work.title}**  \n:gray[{work.first_author} · {work.year}]  \n"
                    f":gray-badge[Not in library] &nbsp; {work.cited_by_count} citations overall &nbsp; "
                    + " &nbsp; ".join(links))
        st.markdown(f"**Cited by {len(lines)} of your papers**  \n" + "  \n".join(lines))


def render_details(
    node_id: str, papers: List[Paper], externals: Dict[str, ExternalWork], links: List[GraphLink],
    view: MapView,
) -> None:
    """
    Show details of clicked node, with citations and AI links

    Args:
        node_id (str): clicked or focused node
        papers (List[Paper]): library papers
        externals (Dict[str, ExternalWork]): external works shown
        links (List[GraphLink]): citation and AI links
        view (MapView): display options
    Returns:
        None
    """
    title_of = {**{p.path: p.display_title for p in papers}, **{w.openalex_id: w.title for w in externals.values()}}
    lines = connection_lines(node_id, links, title_of)
    by_path = {p.path: p for p in papers}
    if node_id in by_path:
        record = load_records(papers).get(node_id)
        render_paper_details(by_path[node_id], record, lines, node_id == view.focus)
    elif node_id in externals:
        render_external_details(externals[node_id], lines)


# ---------- CONTROLS ----------


def render_view_controls(papers: List[Paper]) -> MapView:
    """
    Render mode, focus paper, depth and layout controls

    Args:
        papers (List[Paper]): papers in map
    Returns:
        MapView: chosen options
    """
    by_path = {p.path: p for p in papers}
    if st.session_state.get("sota_map_focus") not in by_path:
        st.session_state.pop("sota_map_focus", None)
    mode_col, focus_col, depth_col = st.columns([2, 3, 1], vertical_alignment="bottom")
    mode = mode_col.segmented_control("Links", [MODE_CITATIONS, MODE_AI], default=MODE_CITATIONS,
                                      key="sota_map_mode") or MODE_CITATIONS
    focus = focus_col.selectbox("Start from paper", list(by_path), index=None, key="sota_map_focus",
                                format_func=lambda path: f"{paper_label(by_path[path])} — {by_path[path].display_title}",
                                placeholder="Full graph")
    depth = depth_col.number_input("Hops", 1, MAX_FOCUS_DEPTH, 1, disabled=focus is None, key="sota_map_depth",
                                   help="How many links away from the paper to show.")
    timeline_col, hide_col = st.columns(2)
    timeline = timeline_col.toggle("Timeline layout", help="Oldest papers on the left, newest on the right.")
    hide_unconnected = hide_col.toggle("Hide unconnected papers")
    return MapView(mode, focus, int(depth), timeline, hide_unconnected)


def render_citation_controls(papers: List[Paper], records: Dict[str, CitationRecord]) -> Tuple[bool, int]:
    """
    Render analysis buttons and shared-reference options

    Args:
        papers (List[Paper]): papers in map
        records (Dict[str, CitationRecord]): analyzed records
    Returns:
        Tuple[bool, int]: show shared references, minimum citing papers
    """
    missing = [p for p in papers if p.path not in records]
    status_col, analyze_col, refresh_col = st.columns([2, 1, 1], vertical_alignment="center")
    status_col.caption(f"References known for {len(records)} / {len(papers)} papers · OpenAlex, then GROBID "
                       "bibliography extraction")
    if analyze_col.button(f"Analyze {len(missing)} new", icon=":material/travel_explore:", type="primary",
                          disabled=not missing, use_container_width=True):
        analyze_citations(missing)
        st.rerun()
    if refresh_col.button("Re-analyze all", icon=":material/refresh:", use_container_width=True):
        analyze_citations(papers)
        st.rerun()
    shared_col, min_col = st.columns(2, vertical_alignment="center")
    show_shared = shared_col.toggle("Show shared references outside library", value=True,
                                    help="Papers you don't have, cited by several of your papers.")
    min_citing = min_col.slider("Cited by at least", 2, 6, 2, disabled=not show_shared, key="sota_map_min_citing")
    return show_shared, min_citing


def render_ai_controls(papers: List[Paper], selected: List[Paper]) -> None:
    """
    Render AI strength threshold and relation search button

    Args:
        papers (List[Paper]): papers in map
        selected (List[Paper]): papers selected in Library tab
    Returns:
        None
    """
    sources = selected or papers
    force_col, button_col = st.columns([2, 1], vertical_alignment="bottom")
    min_force = force_col.slider("Minimum relation strength kept", 0.0, MAX_AI_FORCE, 1.0, 0.1, key="sota_map_force")
    if button_col.button(f"Find relations for {len(sources)} paper(s)", icon=":material/auto_awesome:",
                         type="primary", use_container_width=True, disabled=len(papers) < 2,
                         help="Uses selected papers of the Library tab, or all papers when none selected."):
        find_ai_relations(sources, papers, min_force)
        st.rerun()


# ---------- TAB ----------


def render_relation_map(papers: List[Paper], selected: List[Paper]) -> None:
    """
    Render Citation & Relation Map tab

    Args:
        papers (List[Paper]): papers of current search
        selected (List[Paper]): papers selected in Library tab
    Returns:
        None
    """
    if not papers:
        st.info("Search your library to build the map.", icon=":material/search:")
        return
    view = render_view_controls(papers)
    records = load_records(papers)
    externals: Dict[str, ExternalWork] = {}
    if view.mode == MODE_CITATIONS:
        show_shared, min_citing = render_citation_controls(papers, records)
        externals = shared_externals(papers, records, min_citing) if show_shared else {}
    else:
        render_ai_controls(papers, selected)
    cites, ai_links = citation_links(papers, records, externals), ai_graph_links(papers)
    drawn_links = cites if view.mode == MODE_CITATIONS else ai_links
    visible = visible_nodes([p.path for p in papers] + list(externals), drawn_links, view)
    drawn_links = [link for link in drawn_links if link.source in visible and link.target in visible]
    degrees = degrees_of(drawn_links)
    drawn_papers = [p for p in papers if p.path in visible]
    drawn_externals = [w for w in externals.values() if w.openalex_id in visible]
    nodes = make_nodes(drawn_papers, drawn_externals, degrees, view)
    clicked = draw_graph(nodes, make_edges(drawn_links), view)
    st.caption(MODE_CAPTIONS[view.mode].format(count=len(drawn_links), papers=len(drawn_papers),
                                               shared=len(drawn_externals)))
    target = clicked if clicked in visible else view.focus
    if target is not None:
        render_details(target, papers, externals, cites + ai_links, view)

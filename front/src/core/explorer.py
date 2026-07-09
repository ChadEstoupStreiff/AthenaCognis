import datetime
import json
from typing import List

import requests
import streamlit as st
from stqdm import stqdm
from utils import get_setting, mimes_map_compressed


def search_files(
    text: str,
    start_date: datetime,
    end_date: datetime,
    subfolder: List[str] = None,
    types: List[str] = None,
    projects: List[str] = None,
    tags: List[str] = None,
    search_mode: int = 0,
    exclude_file_types: bool = False,
    exclude_subfolders: bool = False,
    exclude_projects: bool = False,
    exclude_tags: bool = False,
):
    # MARK: SEARCH FILES
    with st.spinner("Searching files...", show_time=True):
        request = f"http://back:80/files/search?start_date={start_date}&end_date={end_date}&search_mode={search_mode}"
        if text is not None:
            request += f"&text={text}"
        if subfolder is not None and len(subfolder) > 0:
            request += f"&subfolder={','.join(subfolder)}&exclude_subfolders={exclude_subfolders}"
        if types is not None and len(types) > 0:
            request += (
                f"&types={','.join(types)}&exclude_file_types={exclude_file_types}"
            )
        if projects is not None and len(projects) > 0:
            request += (
                f"&projects={','.join(projects)}&exclude_projects={exclude_projects}"
            )
        if tags is not None and len(tags) > 0:
            request += f"&tags={','.join(tags)}&exclude_tags={exclude_tags}"

        start_time = datetime.datetime.now()
        result = requests.get(request)
        end_time = datetime.datetime.now()

    files = []
    if result.status_code == 200:
        st.toast(
            f"Found {len(result.json())} files matching the criteria.",
        )
        files = result.json()
    else:
        st.toast(
            f"Failed to search files: {result.text}",
            icon="❌",
        )
        st.error(f"Failed to search files: {result.text}")
    return {
        "query": text,
        "start_date": start_date,
        "end_date": end_date,
        "types": types,
        "subfolder": subfolder,
        "projects": projects,
        "tags": tags,
        "files": files,
        "search_mode": search_mode,
        "time_spent": end_time - start_time,
        "exclude_file_types": exclude_file_types,
        "exclude_subfolders": exclude_subfolders,
        "exclude_projects": exclude_projects,
        "exclude_tags": exclude_tags,
    }


def search_files_stream(
    text,
    start_date,
    end_date,
    subfolder=None,
    types=None,
    projects=None,
    tags=None,
    search_mode=0,
    exclude_file_types=False,
    exclude_subfolders=False,
    exclude_projects=False,
    exclude_tags=False,
    semantic=False,
    similarity_threshold=0.4,
):
    """Generator that yields event dicts from the backend NDJSON stream.

    Event types:
      {"type": "total",              "count": N}
      {"type": "progress",           "current": i, "total": N, "file": name}
      {"type": "semantic_searching", "count": N}
      {"type": "result",             "path": "/shared/..."}
      {"type": "error",              "message": "..."}
    """
    request = f"http://back:80/files/search/stream?start_date={start_date}&end_date={end_date}&search_mode={search_mode}&semantic={semantic}&similarity_threshold={similarity_threshold}"
    if text is not None:
        request += f"&text={text}"
    if subfolder is not None and len(subfolder) > 0:
        request += f"&subfolder={','.join(subfolder)}&exclude_subfolders={exclude_subfolders}"
    if types is not None and len(types) > 0:
        request += f"&types={','.join(types)}&exclude_file_types={exclude_file_types}"
    if projects is not None and len(projects) > 0:
        request += f"&projects={','.join(projects)}&exclude_projects={exclude_projects}"
    if tags is not None and len(tags) > 0:
        request += f"&tags={','.join(tags)}&exclude_tags={exclude_tags}"

    with requests.get(request, stream=True) as response:
        if response.status_code == 200:
            for line in response.iter_lines():
                if line:
                    yield json.loads(line)
        else:
            yield {"type": "error", "message": response.text}


def run_streaming_search(search_params):
    """Run a streaming search with a stqdm progress bar. Returns a result dict
    compatible with generate_query_description and session state storage."""
    start_time = datetime.datetime.now()
    files = []
    total = 0

    placeholder = st.empty()

    with placeholder.container():
        pbar = stqdm(total=1, desc="Starting search...")

        for event in search_files_stream(
            text=search_params["query"],
            start_date=search_params["start_date"],
            end_date=search_params["end_date"],
            subfolder=search_params["subfolder"],
            types=search_params["types"],
            projects=search_params["projects"],
            tags=search_params["tags"],
            search_mode=search_params["search_mode"],
            exclude_file_types=search_params["exclude_file_types"],
            exclude_subfolders=search_params["exclude_subfolders"],
            exclude_projects=search_params["exclude_projects"],
            exclude_tags=search_params["exclude_tags"],
            semantic=search_params.get("semantic", False),
            similarity_threshold=float(get_setting("semantic_similarity_threshold", 0.4)),
        ):
            etype = event.get("type")
            if etype == "total":
                total = event["count"]
                pbar.total = max(total, 1)
                pbar.set_description(f"Watched 0 / {total} files")
                pbar.refresh()
            elif etype == "progress":
                pbar.set_description(
                    f"Watching {event['current']} / {event['total']}  —  {event.get('file', '')}"
                )
                pbar.update(1)
            elif etype == "semantic_searching":
                pbar.set_description(f"✨ Checking {event['count']} files semantically...")
                pbar.refresh()
            elif etype == "result":
                files.append(event["path"])
            elif etype == "error":
                st.error(f"Search error: {event['message']}")

        pbar.close()
    placeholder.empty()
    end_time = datetime.datetime.now()

    return {
        **search_params,
        "files": files,
        "time_spent": end_time - start_time,
    }


def search_engine(
    nbr_columns: int = 6,
    force_types: List[str] = None,
    force_subfolder: List[str] = None,
    force_tags: List[str] = None,
    force_projects: List[str] = None,
    force_start_date: datetime = None,
    streaming: bool = False,
):
    with st.form("file_search_form", clear_on_submit=False):
        search_text = st.text_input(
            "Search files",
            placeholder="Enter file name, content or keyword...",
            key="search_files",
        )
        cols = st.columns(nbr_columns)
        with cols[0]:
            with st.container(height=120, border=False):
                search_dates = st.date_input(
                    "Search by date",
                    value=(
                        datetime.date.today()
                        - datetime.timedelta(
                            days=get_setting("search_default_timeframe_days", 30)
                        ),
                        datetime.date.today(),
                    ),
                    key="search_dates",
                    help="Select a date to filter files.",
                )
        with cols[1 % nbr_columns]:
            with st.container(height=120, border=False):
                file_types = st.multiselect(
                    "File Types",
                    options=mimes_map_compressed.keys(),
                    key="file_types",
                    help="Select file types to filter files.",
                )
                file_types = [mimes_map_compressed[x] for x in file_types]
                file_types = [x for xs in file_types for x in xs]
                exclude_file_types = st.toggle(
                    "Exclude File Types",
                    key="exclude_file_types",
                    help="Toggle to exclude selected file types from the search.",
                )
        with cols[2 % nbr_columns]:
            with st.container(height=120, border=False):
                subfolder = st.multiselect(
                    "Subfolders",
                    options=[
                        "uploads",
                        "notes",
                        "audio",
                    ],
                    key="subfolders",
                    help="Select subfolders to filter files.",
                )
                exuclude_subfolders = st.toggle(
                    "Exclude Subfolders",
                    key="exclude_subfolders",
                    help="Toggle to exclude selected subfolders from the search.",
                )

        with cols[3 % nbr_columns]:
            with st.container(height=120, border=False):
                projects_list = requests.get("http://back:80/projects").json()
                projects = st.multiselect(
                    "Projects",
                    options=[p["name"] for p in projects_list],
                    key="projects",
                    help="Select projects to filter files.",
                )
                exclude_projects = st.toggle(
                    "Exclude Projects",
                    key="exclude_projects",
                    help="Toggle to exclude selected projects from the search.",
                )

        with cols[4 % nbr_columns]:
            with st.container(height=120, border=False):
                tags_list = requests.get("http://back:80/tags").json()
                tags = st.multiselect(
                    "Tags",
                    options=[t["name"] for t in tags_list],
                    key="tags",
                    help="Select tags to filter files.",
                )
                exclude_tags = st.toggle(
                    "Exclude Tags",
                    key="exclude_tags",
                    help="Toggle to exclude selected tags from the search.",
                )

        with cols[5 % nbr_columns]:
            with st.container(border=False):
                representation_options = [
                    "⚡️",
                    "🔍",
                    "🧠",
                ]
                search_mode = st.segmented_control(
                    "Search mode",
                    options=range(len(representation_options)),
                    format_func=lambda x: representation_options[x],
                    default=1,
                    help="Choose the search mode (⚡️ Quick, 🔍 Normal, 🧠 Deep). Quick Search is fast but less accurate — it only looks at keywords and notes. Normal Search also includes summaries. Deep Search is the most thorough (and slowest), scanning the full file content.",
                    key="search_mode",
                )
                if search_mode is None:
                    search_mode = 1
                semantic = st.toggle(
                    "✨ Semantic boost",
                    key="semantic_boost",
                    help="After the keyword search, also include files that are semantically close to your query — even if they contain none of the typed words.",
                )
        if force_types is not None or force_subfolder is not None or force_tags is not None or force_projects is not None:
            forced_caption = "Forced filters applied:"
            if force_types is not None:
                forced_caption += f" Types: {', '.join(force_types)}."
            if force_subfolder is not None:
                forced_caption += f" Subfolders: {', '.join(force_subfolder)}."
            if force_tags is not None:
                forced_caption += f" Tags: {', '.join(force_tags)}."
            if force_projects is not None:
                forced_caption += f" Projects: {', '.join(force_projects)}."
            st.caption(forced_caption)
        if st.form_submit_button(
            "Search",
            use_container_width=True,
            help="Click to search files based on the criteria.",
            type="primary",
        ):
            if force_types is not None:
                for t in force_types:
                    if t not in file_types:
                        file_types.append(t)
            if force_subfolder is not None:
                for s in force_subfolder:
                    if s not in subfolder:
                        subfolder.append(s)
            if force_tags is not None:
                for t in force_tags:
                    if t not in tags:
                        tags.append(t)
            if force_projects is not None:
                for p in force_projects:
                    if p not in projects:
                        projects.append(p)
            text = search_text if len(search_text) > 0 else None
            if streaming:
                return {
                    "query": text,
                    "start_date": search_dates[0],
                    "end_date": search_dates[1],
                    "types": file_types,
                    "subfolder": subfolder,
                    "projects": projects,
                    "tags": tags,
                    "search_mode": search_mode,
                    "exclude_file_types": exclude_file_types,
                    "exclude_subfolders": exuclude_subfolders,
                    "exclude_projects": exclude_projects,
                    "exclude_tags": exclude_tags,
                    "semantic": semantic,
                }
            return search_files(
                text,
                search_dates[0],
                search_dates[1],
                subfolder,
                file_types,
                projects,
                tags,
                search_mode,
                exclude_file_types=exclude_file_types,
                exclude_subfolders=exuclude_subfolders,
                exclude_projects=exclude_projects,
                exclude_tags=exclude_tags,
            )
    return None


def generate_query_description(search_result):
    query_str = f"Found {len(search_result['files'])} files in {search_result['time_spent'].total_seconds():.3f}s with mode {search_result['search_mode']} beetween {search_result['start_date']} and {search_result['end_date']}"
    if search_result["query"] is not None and len(search_result["query"]) > 0:
        query_str += f" with query '{search_result['query']}'"
    if search_result["types"] is not None and len(search_result["types"]) > 0:
        query_str += f" and types {', '.join(search_result['types'])}" + (
            "" if not search_result["exclude_file_types"] else " (excluded)"
        )
    if search_result["subfolder"] is not None and len(search_result["subfolder"]) > 0:
        query_str += f" and subfolders {', '.join(search_result['subfolder'])}" + (
            "" if not search_result["exclude_subfolders"] else " (excluded)"
        )
    if search_result["projects"] is not None and len(search_result["projects"]) > 0:
        query_str += f" and projects {', '.join(search_result['projects'])}" + (
            "" if not search_result["exclude_projects"] else " (excluded)"
        )
    if search_result["tags"] is not None and len(search_result["tags"]) > 0:
        query_str += f" and tags {', '.join(search_result['tags'])}" + (
            "" if not search_result["exclude_tags"] else " (excluded)"
        )
    return query_str

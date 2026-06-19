import datetime
import json
import math
import os
from typing import List

import requests
import streamlit as st
from core.contacts import render_contact_pills
from core.explorer import run_streaming_search, search_engine as file_search_engine
from core.files import display_files, representation_mode_select
from core.ocr import _bbox_from_any, _draw_label, _open_image
from pages import PAGE_EXPLORER, PAGE_NOTES, PAGE_VIEWER
from PIL import ImageDraw
from streamlit_agraph import Config, Edge, Node, agraph
from utils import (
    clear_cache,
    delete_file,
    download_and_display_file,
    download_file_button,
    generate_aside_project_markdown,
    generate_aside_tag_markdown,
    generate_project_visual_markdown,
    generate_tag_visual_markdown,
    get_setting,
    guess_mime,
    paths_to_markdown_tree,
    refractor_text_area,
    spacer,
    toast_for_rerun,
)
from views.settings import tasks as list_tasks


@st.dialog("🗑️ Delete file")
def dialog_delete_file(file):
    # MARK: DELETE FILE
    """
    This dialog is used to confirm the deletion of a file.
    It provides a button to delete the file and a button to cancel the action.
    """
    st.markdown(
        f"Are you sure you want to delete the file:\n  **{os.path.basename(file)}**?\n This action cannot be undone."
    )
    if st.button("Delete 🗑️", use_container_width=True):
        result = delete_file(file)
        if result.status_code == 200:
            toast_for_rerun(
                "File deleted successfully.",
                icon="🗑️",
            )
            clear_cache()
            st.rerun()
        else:
            st.error("Failed to delete the file. Please try again.")


@st.dialog("✏️ Edit file details", width="large")
def dialog_edit_file(file: str, projects: List[str], tags: List[str]):
    # MARK: EDIT FILE DETAILS
    """
    This dialog is used to edit the details of a file.
    It provides fields to edit the file name, subfolder, and date.
    """
    file_name = os.path.basename(file)
    date = file.split("/")[2]
    subfolder = file.split("/")[3]
    st.markdown(f"Edit details for file: **{file_name}**")

    new_name = st.text_input(
        "File Name",
        value=file_name,
        help="Enter the new name for the file.",
    )
    new_date = st.date_input(
        "Date",
        value=datetime.datetime.strptime(date, "%Y-%m-%d").date(),
        help="Select the new date for the file.",
    ).strftime("%Y-%m-%d")

    if new_name != file_name:
        st.warning(
            f"You are about to change the file name to {new_name}. This action cannot be undone."
        )
    if new_date != date:
        st.warning(
            f"You are about to change the date to {new_date}. This action cannot be undone."
        )
    if st.button("Save Changes", use_container_width=True, type="primary"):
        if new_name != file_name or new_date != date:
            result_move = requests.post(
                f"http://back:80/files/move/{file}?name={new_name}&date={new_date}&subfolder={subfolder}",
            )
            if result_move.status_code != 200:
                st.error(
                    "Failed to update file details. Please check the file name and date."
                )
                return
        toast_for_rerun(
            "File details updated successfully.",
            icon="✅",
        )
        clear_cache()
        st.session_state["file_to_see"] = (
            "/shared/" + new_date + "/" + subfolder + "/" + new_name
        )
        st.rerun()
    st.divider()

    all_projects = [
        p for p in requests.get("http://back:80/projects").json() if p not in projects
    ]
    all_tags = [t for t in requests.get("http://back:80/tags").json() if t not in tags]

    cols = st.columns(2)
    with cols[0]:
        st.markdown("### Projects")
        new_project = st.selectbox(
            "Add to project",
            options=all_projects,
            format_func=lambda x: x["name"],
            key="add_project",
            help="Select a project to add this file to.",
        )
        if st.button(
            "Add Project",
            use_container_width=True,
            type="primary",
            help="Click to add the selected project to this file.",
        ):
            result_add = requests.post(
                f"http://back:80/project/{new_project['name']}/file?file={file}",
            )
            if result_add.status_code == 200:
                toast_for_rerun(
                    "Project added successfully.",
                    icon="✅",
                )
                st.rerun()
            else:
                st.error("Failed to add project. Please try again.")

        if len(projects) == 0:
            st.info("This file is not associated with any project.")
        else:
            for project in projects:
                p_cols = st.columns([1, 2])
                with p_cols[0]:
                    if st.button(
                        "🗑️",
                        key=f"remove_project_{project['name']}",
                        help=f"Click to remove the project {project['name']} from this file.",
                        use_container_width=True,
                    ):
                        requests.delete(
                            f"http://back:80/project/{project['name']}/file?file={file}"
                        )
                        toast_for_rerun(
                            "Project removed successfully.",
                            icon="🗑️",
                        )
                        st.rerun()
                with p_cols[1]:
                    st.markdown(
                        generate_project_visual_markdown(
                            project["name"], project["color"]
                        ),
                        unsafe_allow_html=True,
                    )

    with cols[1]:
        st.markdown("### Tags")
        new_tag = st.selectbox(
            "Add Tag",
            options=all_tags,
            format_func=lambda x: x["name"],
            key="add_tag",
            help="Select a tag to add to this file.",
        )
        if st.button(
            "Add Tag",
            use_container_width=True,
            type="primary",
            help="Click to add the selected tag to this file.",
        ):
            result_add = requests.post(
                f"http://back:80/tag/{new_tag['name']}/file?file={file}",
            )
            if result_add.status_code == 200:
                toast_for_rerun(
                    "Tag added successfully.",
                    icon="✅",
                )
                st.rerun()
            else:
                st.error("Failed to add tag. Please try again.")

        if len(tags) == 0:
            st.info("This file is not associated with any tags.")
        else:
            for tag in tags:
                t_cols = st.columns([1, 2])
                with t_cols[0]:
                    if st.button(
                        "🗑️",
                        key=f"remove_tag_{tag['name']}",
                        help=f"Click to remove the tag {tag['name']} from this file.",
                        use_container_width=True,
                    ):
                        requests.delete(
                            f"http://back:80/tag/{tag['name']}/file?file={file}"
                        )
                        toast_for_rerun(
                            "Tag removed successfully.",
                            icon="🗑️",
                        )
                        st.rerun()
                with t_cols[1]:
                    st.markdown(
                        generate_tag_visual_markdown(tag["name"], tag["color"]),
                        unsafe_allow_html=True,
                    )


# MARK: AUTO LINK
@st.dialog("🤖 Auto Link", width="large")
def dialog_auto_link(file):
    st.caption(
        "Select files to analyze, then let the AI find semantic links between them and the current file."
    )

    with st.expander("Search Files to Analyze", expanded=True):
        search_params = file_search_engine(nbr_columns=3, streaming=True)
        if search_params is not None:
            st.session_state.auto_link_search_files = run_streaming_search(search_params)["files"]

    selected_files = []
    if "auto_link_search_files" in st.session_state:
        representation_mode, show_preview, nbr_of_files_per_line = (
            representation_mode_select(
                default_mode=get_setting("link_files_default_representation_mode")
            )
        )
        selected_files = display_files(
            st.session_state.auto_link_search_files,
            representation_mode=representation_mode,
            show_preview=show_preview,
            nbr_of_files_per_line=nbr_of_files_per_line,
            multi_select_mode=1,
            allow_actions=False,
            key="auto_link_search_files_selection",
        )

    target_files = [f for f in (selected_files or []) if f != file]
    if st.button(
        "🔍 Find Links with AI",
        disabled=not target_files,
        use_container_width=True,
        help="Send the selected files to the AI to find semantic links with the current file.",
    ):
        with st.spinner("AI is analyzing the files..."):
            result = requests.post(
                "http://back:80/links/auto-find",
                json={"source_file": file, "target_files": target_files},
            )
        if result.status_code == 200:
            st.session_state.auto_link_suggestions = result.json()
        else:
            st.error(f"AI error: {result.text}")

    force_threshold = st.number_input(
        "Minimum Force Threshold",
        min_value=0.1,
        max_value=3.0,
        value=0.5,
        step=0.1,
        help="Links with a force below this threshold will be unchecked by default.",
    )
    suggestions = st.session_state.get("auto_link_suggestions", [])
    if suggestions:
        st.divider()
        st.markdown(f"**{len(suggestions)} link(s) found** — review and edit before adding:")
        edited = []
        for i, link in enumerate(suggestions):
            with st.container(border=True):
                cols = st.columns([5, 2, 1])
                with cols[0]:
                    target_name = link["fileB"].split("/")[-1]
                    st.markdown(f"🔗 **{target_name}**")
                    comment = st.text_input(
                        "Comment",
                        value=link.get("comment", ""),
                        key=f"auto_link_comment_{i}",
                        label_visibility="collapsed",
                        placeholder="Link comment...",
                    )
                with cols[1]:
                    force = st.number_input(
                        "Force",
                        min_value=0.0,
                        value=float(link.get("force", 1.0)),
                        step=0.1,
                        key=f"auto_link_force_{i}",
                    )
                with cols[2]:
                    selected = st.checkbox(
                        "✓",
                        value=float(link.get("force", 1.0)) >= force_threshold,
                        key=f"auto_link_select_{i}",
                        help="Select this link to add it.",
                    )
                edited.append(
                    {
                        "fileA": link["fileA"],
                        "fileB": link["fileB"],
                        "force": force,
                        "comment": comment,
                        "selected": selected,
                    }
                )

        selected_links = [e for e in edited if e["selected"]]
        btn_cols = st.columns(2)
        with btn_cols[0]:
            if st.button(
                "➕ Add Selected",
                disabled=not selected_links,
                use_container_width=True,
                help="Add selected links without removing existing ones.",
            ):
                for link in selected_links:
                    requests.post(
                        "http://back:80/links/add",
                        params={
                            "fileA": link["fileA"],
                            "fileB": link["fileB"],
                            "force": link["force"],
                            "comment": link["comment"],
                        },
                    )
                del st.session_state.auto_link_suggestions
                if "auto_link_search_files" in st.session_state:
                    del st.session_state.auto_link_search_files
                toast_for_rerun(f"Added {len(selected_links)} link(s).", icon="✅")
                st.rerun()
        with btn_cols[1]:
            if st.button(
                "🔄 Overwrite Links",
                disabled=not selected_links,
                use_container_width=True,
                help="Remove all existing links for the current file, then add selected ones.",
            ):
                existing = requests.get(f"http://back:80/links/list/{file}")
                if existing.status_code == 200 and existing.json():
                    for old_link in existing.json():
                        requests.delete(
                            f"http://back:80/links/remove?fileA={file}&fileB={old_link[0]}"
                        )
                for link in selected_links:
                    requests.post(
                        "http://back:80/links/add",
                        params={
                            "fileA": link["fileA"],
                            "fileB": link["fileB"],
                            "force": link["force"],
                            "comment": link["comment"],
                        },
                    )
                del st.session_state.auto_link_suggestions
                if "auto_link_search_files" in st.session_state:
                    del st.session_state.auto_link_search_files
                toast_for_rerun(
                    f"Links overwritten with {len(selected_links)} new link(s).", icon="🔄"
                )
                st.rerun()
    elif "auto_link_suggestions" in st.session_state:
        st.info("No semantic links found between the selected files.")


# MARK: ADD LINK
@st.dialog("🔗 Add Link", width="large")
def dialog_add_link(file):
    with st.expander("Search Files", expanded=True):
        search_params = file_search_engine(nbr_columns=3, streaming=True)
        if search_params is not None:
            st.session_state.link_search_files = run_streaming_search(search_params)["files"]

    if "link_search_files" in st.session_state:
        representation_mode, show_preview, nbr_of_files_per_line = (
            representation_mode_select(
                default_mode=get_setting("link_files_default_representation_mode")
            )
        )
        selected = display_files(
            st.session_state.link_search_files,
            representation_mode=representation_mode,
            show_preview=show_preview,
            nbr_of_files_per_line=nbr_of_files_per_line,
            multi_select_mode=1,
            allow_actions=False,
            key="link_search_files_selection",
        )
    else:
        selected = []

    force = st.number_input(
        "Link Force",
        min_value=0.1,
        max_value=10.0,
        value=1.0,
        step=0.1,
        help="Set the force of the link between the files.",
    )
    comment = st.text_area(
        "Link Comment",
        value="",
    )
    if st.button("Add Selected Files", disabled=not selected, use_container_width=True):
        for selected_file in selected:
            requests.post(
                "http://back:80/links/add",
                params={
                    "fileA": file,
                    "fileB": selected_file,
                    "force": force,
                    "comment": comment,
                },
            )
        del st.session_state.link_search_files
        toast_for_rerun(
            f"Added {len(selected)} files to the links.",
            icon="✅",
        )
        st.rerun()


# MARK: GET EDGES AND NODES FOR FILE LINKS
def get_edges_and_nodes(
    file,
    recursive: bool = True,
    visited=None,
    edge_memory=None,
    first=True,
):
    if visited is None:
        visited = set()
    if edge_memory is None:
        edge_memory = set()
    if file in visited:
        return [], [], visited, edge_memory
    visited.add(file)
    edges = []
    nodes = [
        Node(
            id=file,
            label=file.split("/")[-1],
            size=30,
            color="#33cfff" if not first else "#ff33dd",
        )
    ]
    result = requests.get(f"http://back:80/links/list/{file}")
    if result.status_code == 200 and result.json() is not None:
        links = result.json()
        for link in links:
            edge_pair = (file, link[0])
            reverse_edge_pair = (link[0], file)
            if not recursive or (
                edge_pair not in edge_memory and reverse_edge_pair not in edge_memory
            ):
                edges.append(
                    Edge(
                        source=file,
                        target=link[0],
                        width=2 * link[1],
                        label=link[2] or "",
                    )
                )
                edge_memory.add(edge_pair)
            if not recursive:
                nodes.append(
                    Node(
                        id=link[0],
                        label=link[0].split("/")[-1],
                        size=20,
                        color="#33cfff",
                    )
                )
        if recursive:
            for link in links:
                if link[0] not in visited:
                    (
                        sub_edges,
                        sub_nodes,
                        sub_visited,
                        sub_edge_memory,
                    ) = get_edges_and_nodes(
                        link[0],
                        visited=visited,
                        edge_memory=edge_memory,
                        first=False,
                    )
                    edges.extend(sub_edges)
                    nodes.extend(sub_nodes)
                    visited.update(sub_visited)
                    edge_memory.update(sub_edge_memory)
    return edges, nodes, visited, edge_memory


def see_file(file):
    # MARK: SEE FILE
    date = file.split("/")[2]
    subfolder = file.split("/")[3]
    file_name = os.path.basename(file)
    mime = guess_mime(file)

    requests.post(
        f"http://back:80/stockpile/recentopened?file={file}",
    )

    is_pinned = requests.get(f"http://back:80/pinned/is_pinned?file={file}").json()

    col1, col2, col3 = st.columns(3)
    with col1:
        download_file_button(file)
    with col2:
        pin_label = "📌 Unpin" if is_pinned else "📌 Pin"
        if st.button(
            pin_label,
            use_container_width=True,
            help="Pin this file to the dashboard." if not is_pinned else "Unpin this file from the dashboard.",
            key=f"see_pin_{file}",
        ):
            if is_pinned:
                requests.delete(f"http://back:80/pinned?file={file}")
                toast_for_rerun("File unpinned from dashboard.", icon="📌")
            else:
                requests.post(f"http://back:80/pinned?file={file}")
                toast_for_rerun("File pinned to dashboard.", icon="📌")
            clear_cache()
            st.rerun()
    with col3:
        if st.button(
            "🗑️",
            use_container_width=True,
            help="Click to delete the file.",
            key=f"see_delete_{file}",
        ):
            dialog_delete_file(file)

    tab_details, tab_notes, tab_links, tab_summarize, tab_tasks, tab_contacts = st.tabs(
        ["📋 Détails", "📝 Notes", "🔗 Links", "🧠 Summary", "⏳ Tasks", "👤 Contacts"]
    )
    # MARK: DETAILS
    metadata = None
    with tab_details:
        cols = st.columns(2)
        with cols[0]:
            st.markdown(f"#### {file_name}")
            st.caption(f"**📅 Date:** {date}")
            st.caption(f"**📁 Subfolder:** {subfolder}")
            st.caption(f"**🛣️ Path:** {file}")

            projects = requests.get(f"http://back:80/projects_of/{file}")
            if projects.status_code == 200:
                projects = projects.json()
            else:
                projects = []
            tags = requests.get(f"http://back:80/tags_of/{file}")
            if tags.status_code == 200:
                tags = tags.json()
            else:
                tags = []

            st.markdown("##### Projects")
            if len(projects) == 0:
                st.info("This file is not associated with any project.")
            else:
                st.markdown(
                    generate_aside_project_markdown(
                        [p["name"] for p in projects],
                        [p["color"] for p in projects],
                    ),
                    unsafe_allow_html=True,
                )

            st.markdown("##### Tags")
            if len(tags) == 0:
                st.info("This file is not associated with any tags.")
            else:
                st.markdown(
                    generate_aside_tag_markdown(
                        [t["name"] for t in tags],
                        [t["color"] for t in tags],
                    ),
                    unsafe_allow_html=True,
                )

            contacts_of_file = requests.get(f"http://back:80/contacts_of/{file}")
            file_contacts = contacts_of_file.json() if contacts_of_file.status_code == 200 else []
            if file_contacts:
                st.markdown("##### Contacts")
                render_contact_pills(file_contacts)

            spacer()
            if st.button("Edit file details", use_container_width=True):
                dialog_edit_file(file, projects=projects, tags=tags)

        with cols[1]:
            result = requests.get(f"http://back:80/files/metadata/{file}")
            if result.status_code == 200:
                metadata = result.json()
                size = metadata.get("size", 0) / (1024 * 1024)
                date_created = datetime.datetime.fromisoformat(
                    metadata.get("created", 0)
                ).strftime("%Y-%m-%d %H:%M:%S")
                date_modified = datetime.datetime.fromisoformat(
                    metadata.get("modified", 0)
                ).strftime("%Y-%m-%d %H:%M:%S")
                path = metadata.get("path", "Unknown")
                mime = metadata.get("mime_type", "Unknown")

                st.markdown(f"**Size:** {size:.3f} Mb")
                st.markdown(f"**Created on:** {date_created}")
                st.markdown(f"**Modified on:** {date_modified}")
                st.markdown(f"**Path:** {path}")
                st.markdown(f"**MIME Type:** {mime}")
            else:
                st.error("Failed to load metadata for this file.")

    # MARK: LINKS
    with tab_links:
        cols = st.columns(2)
        with cols[0]:
            if st.button(
                "🤖 Auto Link",
                use_container_width=True,
                help="Let the AI find semantic links between files.",
            ):
                if "auto_link_suggestions" in st.session_state:
                    del st.session_state.auto_link_suggestions
                dialog_auto_link(file)
        with cols[1]:
            if st.button(
                "🔗 Add Link",
                use_container_width=True,
                help="Click to add a link to another file.",
            ):
                dialog_add_link(file)

        result = requests.get(f"http://back:80/links/list/{file}")
        if result.status_code == 200 and result.json() is not None:
            links = result.json()
            if len(links) == 0:
                st.info("No links available for this file.")
            else:
                full_tree = st.toggle(
                    "🌳 Full tree",
                    value=True,
                    help="Toggle to show the full tree of linked files.",
                )
                hierarchical_tree = st.toggle(
                    "Hierarchical layout",
                    value=True,
                    help="Toggle to show the links in a hierarchical layout.",
                )

                edges, nodes, _, _ = (
                    get_edges_and_nodes(file, recursive=True)
                    if full_tree
                    else (get_edges_and_nodes(file, recursive=False))
                )
                # nodes.append(
                #     Node(
                #         id=file,
                #         label=file.split("/")[-1],
                #         size=30,
                #         color="#ff33dd",
                #     )
                # )
                config = Config(
                    width=900,
                    height=600,
                    directed=False,
                    physics=not hierarchical_tree,
                    hierarchical=hierarchical_tree,
                )

                return_value = agraph(nodes=nodes, edges=edges, config=config)
                if return_value is not None:
                    st.session_state["file_to_see"] = return_value
                    st.switch_page(PAGE_VIEWER)

                delete_button = st.toggle(
                    "Delete Link Mode",
                    help="Select 'On' to enable delete link mode. In this mode, you can delete links by clicking the delete button next to each link.",
                )
                for link in sorted(links, key=lambda x: x[1], reverse=True):
                    cols = st.columns([1, 6])
                    with cols[0]:
                        if delete_button:
                            if st.button(
                                "🗑️",
                                use_container_width=True,
                                help=f"Click to remove the link to {link[0]}.",
                                key=f"delete_link_{link[0]}",
                            ):
                                result = requests.delete(
                                    f"http://back:80/links/remove?fileA={file}&fileB={link[0]}"
                                )
                                if result.status_code == 200:
                                    toast_for_rerun(
                                        "Link removed successfully.",
                                        icon="🗑️",
                                    )
                                    st.rerun()
                                else:
                                    st.error("Failed to remove link. Please try again.")
                        else:
                            if st.button(
                                "🔍",
                                use_container_width=True,
                                help=f"Click to view the linked file {link[0]}.",
                                key=f"view_link_{link[0]}",
                            ):
                                st.session_state["file_to_see"] = link[0]
                                st.switch_page(PAGE_VIEWER)
                    with cols[1]:
                        st.markdown(f"##### {link[1]} 🔗 {link[0].split('/')[-1]}")
                        if link[2]:
                            st.markdown(f"{link[2]}")
        else:
            st.warning("No links available for this file.")

    # MARK: SUMMARIZE
    with tab_summarize:
        result = requests.get(f"http://back:80/summarize/get/{file}")
        if result.status_code == 200 and result.json() is not None:
            summary = result.json().get("summary", "")
            keywords = result.json().get("keywords", [])
            st.caption(f"Keywords : {', '.join(keywords)}")
            with st.container(border=True):
                st.markdown(summary)
        else:
            st.info(
                "No summary available for this file. You can create a summary by clicking the button below."
            )
        if st.button(
            "Ask for summary",
            use_container_width=True,
            help="Click to create a summary for this file.",
        ):
            result = requests.post(f"http://back:80/summarize/ask/{file}")
            if result.status_code == 200:
                toast_for_rerun(
                    "Summary task created successfully. It may take some time to process.",
                    icon="✅",
                )
                st.rerun()
            else:
                st.error("Failed to ask summary.")

    # MARK: NOTES
    with tab_notes:
        result = requests.get(f"http://back:80/notes/{file}")
        if result.status_code == 200 and result.json() is not None:
            notes = result.json().get("note", "")

            def update_notes(file):
                result_update = requests.post(
                    f"http://back:80/notes/{file}?note={st.session_state['file_notes']}",
                )
                if result_update.status_code == 200:
                    st.toast(
                        "Notes updated successfully.",
                        icon="✅",
                    )
                else:
                    st.error("Failed to update notes. Please try again later.")

            refractor_text_area(
                "Notes",
                value=notes,
                height=500,
                help="These are the notes for the file. They are used in search context and can be edited.",
                key="file_notes",
                on_change=update_notes,
                args=(file,),
            )

        else:
            st.error("Failed to load notes for this file.")

    # MARK: TASKS
    with tab_tasks:
        list_tasks(
            file,
            list_ocr=True if mime.startswith("image/") else False,
            list_transcription=True
            if mime.startswith("audio/") or mime.startswith("video/")
            else False,
        )

    # MARK: CONTACTS
    with tab_contacts:
        import base64 as _b64

        resp = requests.get(f"http://back:80/contacts_of/{file}")
        linked_contacts = resp.json() if resp.status_code == 200 else []

        all_contacts_resp = requests.get("http://back:80/contacts")
        all_contacts = all_contacts_resp.json() if all_contacts_resp.status_code == 200 else []
        linked_ids = {c["id"] for c in linked_contacts}
        available_contacts = [c for c in all_contacts if c["id"] not in linked_ids]

        # Quick-add row always at the top
        add_cols = st.columns([4, 1])
        with add_cols[0]:
            new_contact = st.selectbox(
                "Link contact",
                options=available_contacts,
                format_func=lambda c: c["name"] + (f" ({c['company']})" if c.get("company") else ""),
                key=f"link_contact_select_{file}",
                label_visibility="collapsed",
                placeholder="Add a contact…",
            ) if available_contacts else None
        with add_cols[1]:
            if st.button("＋ Link", use_container_width=True, key=f"link_contact_btn_{file}", disabled=not available_contacts):
                requests.post(
                    f"http://back:80/contact/{new_contact['id']}/file",
                    params={"file": file},
                )
                toast_for_rerun("Contact linked.", icon="✅")
                st.rerun()

        if linked_contacts:
            st.divider()
            for contact in linked_contacts:
                avatar_resp = requests.get(f"http://back:80/contact/{contact['id']}/photo")
                avatar_html = ""
                if avatar_resp.status_code == 200:
                    b64 = _b64.b64encode(avatar_resp.content).decode()
                    avatar_html = (
                        f'<img src="data:image/jpeg;base64,{b64}" '
                        f'style="width:40px;height:40px;border-radius:50%;'
                        f'object-fit:cover;vertical-align:middle;margin-right:8px;">'
                    )

                av_col, info_col, btn_col = st.columns([1, 6, 1])
                with av_col:
                    if avatar_html:
                        st.markdown(avatar_html, unsafe_allow_html=True)
                    else:
                        st.markdown(
                            '<div style="width:40px;height:40px;border-radius:50%;'
                            'background:#555;display:flex;align-items:center;'
                            'justify-content:center;font-size:1.2rem;">👤</div>',
                            unsafe_allow_html=True,
                        )
                with info_col:
                    subtitle = " · ".join(filter(None, [contact.get("role"), contact.get("company")]))
                    st.markdown(f"**{contact['name']}**" + (f"  ·  {subtitle}" if subtitle else ""))
                    details = "  ·  ".join(filter(None, [
                        f"📧 {contact['email']}" if contact.get("email") else None,
                        f"📞 {contact['phone']}" if contact.get("phone") else None,
                    ]))
                    if details:
                        st.caption(details)
                with btn_col:
                    if st.button(
                        "🗑️",
                        key=f"unlink_contact_{contact['id']}_{file}",
                        help=f"Unlink {contact['name']}",
                        use_container_width=True,
                    ):
                        requests.delete(
                            f"http://back:80/contact/{contact['id']}/file",
                            params={"file": file},
                        )
                        toast_for_rerun("Contact unlinked.", icon="🗑️")
                        st.rerun()
        elif not available_contacts:
            st.caption("No contacts exist yet. Create one in the Contacts page.")

    return {
        "file_name": file_name,
        "date": date,
        "subfolder": subfolder,
        "mime": mime,
        "projects": projects,
        "tags": tags,
        "metadata": metadata,
    }


def view():
    if "file_to_see" not in st.session_state:
        # st.error("No file selected to view. Please select a file from the explorer.")
        st.switch_page(PAGE_EXPLORER)
        return
    file = st.session_state.file_to_see

    with st.sidebar:
        side_by_side = st.toggle("Side by Side", value=True)

    cols = st.columns(2 if side_by_side else 1)
    with cols[0]:
        # if st.button(
        #     "🔙 Back to Explorer",
        #     on_click=lambda: st.session_state.pop("file_to_see", None),
        #     use_container_width=True,
        #     key="back_to_explorer",
        # ):
        #     st.switch_page(PAGE_EXPLORER)
        infos = see_file(file)

    with cols[1 if side_by_side else 0]:
        # MARK: FILE PREVIEW
        with st.container(border=True):
            top = st.container()

            mime = guess_mime(file)

            if mime is None:
                st.error("Could not determine the file type. Please check the file.")

            elif mime.endswith("markdown"):
                with top:
                    if st.button("📝 Edit in note", use_container_width=True):
                        st.session_state["note_name"] = file
                        if "note_content" in st.session_state:
                            del st.session_state["note_content"]
                        st.switch_page(PAGE_NOTES)

            elif mime.startswith("audio/") or mime.startswith("video/"):
                # MARK: TRANSCRIPTION
                with st.spinner("Loading transcription...", show_time=True):
                    result = requests.get(f"http://back:80/transcription/get/{file}")
                if result.status_code == 200 and result.json() is not None:
                    st.subheader("Transcription")
                    st.write(result.json().get("transcription", ""))
                else:
                    st.error("Failed to load transcription. Please try again later.")
                if st.button("Ask for transcription", use_container_width=True):
                    result = requests.post(
                        f"http://back:80/transcription/ask/{file}",
                    )
                    if result.status_code == 200:
                        toast_for_rerun(
                            "Transcription task created successfully. It may take some time to process.",
                            icon="✅",
                        )
                        st.rerun()
                    else:
                        st.error("Failed to create transcription task.")

            elif mime.startswith("image/"):
                # MARK: OCR

                with st.spinner("Loading OCR & BLIP...", show_time=True):
                    result = requests.get(f"http://back:80/ocr/get/{file}")

                if result.status_code == 200 and result.json() is not None:
                    blip_result = result.json().get("blip", "")
                    if blip_result:
                        st.write(blip_result)
                    else:
                        st.info(
                            "No BLIP description available. You can create a BLIP description by clicking the button below."
                        )
                    with st.container(border=True):
                        st.subheader("OCR")
                        ocr_result = result.json().get("ocr", "")
                        try:
                            ocr_json = json.loads(ocr_result)
                            ocr_cols = st.columns(3)
                            with ocr_cols[0]:
                                show_score = st.toggle(
                                    "Show OCR confidence score",
                                    value=False,
                                    key="show_ocr_score",
                                )
                            with ocr_cols[1]:
                                show_json = st.toggle(
                                    "Show OCR JSON",
                                    value=False,
                                    key="show_ocr_json",
                                )
                            with ocr_cols[2]:
                                show_text = st.toggle(
                                    "Show OCR text on Image",
                                    value=False,
                                    key="show_ocr_text",
                                )

                            st.divider()

                            if show_text:
                                img = _open_image(file)
                                W, H = img.size
                                draw = ImageDraw.Draw(img)

                                # Each item is assumed like: [bbox, [text, score]] (given your accesses item[1][0], item[1][1])
                                for item in ocr_json:
                                    try:
                                        bbox_raw = item[0]
                                        text = str(item[1][0])
                                        score = (
                                            float(item[1][1])
                                            if isinstance(item[1][1], (int, float, str))
                                            else None
                                        )
                                    except Exception:
                                        # If structure differs, try keys
                                        bbox_raw = (
                                            item.get("bbox")
                                            or item.get("poly")
                                            or item.get("box")
                                            or [0, 0, W, H]
                                        )
                                        text = item.get("text", "")
                                        score = item.get("score", None)

                                    xyxy = _bbox_from_any(bbox_raw, W, H)
                                    label = (
                                        f"{text}"
                                        if not show_score or score is None
                                        else f"{score * 100:.2f}%: {text}"
                                    )
                                    # Scale label thickness by image size
                                    scale = math.sqrt((W * H) / (100 * 100))
                                    _draw_label(
                                        draw,
                                        xyxy,
                                        label,
                                        scale=max(0.7, min(2.0, scale)),
                                    )

                                st.image(
                                    img, caption="OCR overlay", use_container_width=True
                                )

                            for item in ocr_json:
                                st.write(
                                    f"{(item[1][1] * 100):.2f}% : {item[1][0]}"
                                    if show_score
                                    else item[1][0]
                                )

                            if show_json:
                                st.json(ocr_json)

                        except json.JSONDecodeError:
                            st.write(ocr_result)
                else:
                    st.error("Failed to load OCR. Please try again later.")

                if st.button("Ask for OCR & BLIP", use_container_width=True):
                    result = requests.post(
                        f"http://back:80/ocr/ask/{file}",
                    )
                    if result.status_code == 200:
                        toast_for_rerun(
                            "OCR & BLIP task created successfully. It may take some time to process.",
                            icon="✅",
                        )
                        st.rerun()
                    else:
                        st.error("Failed to create OCR & BLIP task.")

            elif (
                file.endswith(".zip")
                or file.endswith(".tar.gz")
                or file.endswith(".tar")
                or file.endswith(".tgz")
            ):
                if "metadata" in infos and "zip_paths" in infos["metadata"]:
                    if infos["metadata"].get("zip_paths_truncated"):
                        total = infos["metadata"].get("zip_paths_total", "?")
                        st.warning(
                            f"Archive contains {total} entries. Showing first 100 only."
                        )
                    st.markdown(
                        paths_to_markdown_tree(
                            infos["metadata"]["zip_paths"],
                        )
                    )
                else:
                    st.error("No archive contents available. Please check the file.")

            with top:
                with st.expander("Preview", expanded=True):
                    download_and_display_file(file)


if __name__ == "__main__":
    view()

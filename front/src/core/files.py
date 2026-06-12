import os

import pandas as pd
import requests
import streamlit as st
from pages import PAGE_VIEWER
from utils import (
    clear_cache,
    delete_file,
    download_and_display_file,
    download_and_display_preview,
    download_file_button,
    generate_aside_project_markdown,
    generate_aside_tag_markdown,
    guess_mime,
    spacer,
    toast_for_rerun,
)


@st.dialog("🗑️ Delete", width="large")
def delete_files_dialog(files, key="delete_files"):
    st.warning(
        "This will delete the selected files permanently. Are you sure you want to proceed?"
    )
    st.markdown(f"Files to delete: \n - {'\n - '.join(files)}")
    if st.button("Delete 🗑️", use_container_width=True, key=f"table_deletion_{key}"):
        error_files = []
        with st.spinner("Deleting files..."):
            for file in files:
                result = delete_file(file)
                if result.status_code != 200:
                    st.error(f"Failed to delete {os.path.basename(file)}.")
                    error_files.append(file)
        if len(error_files) == 0:
            toast_for_rerun(
                f"{len(files)} files deleted successfully.",
                icon="🗑️",
            )
        else:
            toast_for_rerun(
                f"Failed to delete {len(error_files)} files. Deleted {len(files) - len(error_files)} files.",
                icon="⚠️",
            )
        clear_cache()
        st.rerun()


@st.dialog("📦 Edit Project", width="small")
def edit_project_dialog(files, key="edit_project"):
    """
    Dialog for editing the project of selected files.
    """
    st.info(f"{len(files)} selected files.")

    if st.button(
        "Clear all projects of all files 🗑️",
        use_container_width=True,
        key=f"clear_project_{key}",
    ):
        error_files = []
        with st.spinner("Clearing projects of files..."):
            for file in files:
                project_files = requests.get(
                    f"http://back:80/projects_of/{file}"
                ).json()
                for project in project_files:
                    result = requests.delete(
                        f"http://back:80/project/{project['name']}/file?file={file}"
                    )
                    if result.status_code != 200:
                        if file not in error_files:
                            st.error(
                                f"Failed to clear project for {os.path.basename(file)}."
                            )
                    error_files.append(file)
        if len(error_files) == 0:
            toast_for_rerun(
                f"Projects cleared for {len(files)} files.",
                icon="📂",
            )
        else:
            toast_for_rerun(
                f"Failed to clear projects for {len(error_files)} files. Project cleared for {len(files) - len(error_files)} files.",
                icon="⚠️",
            )
        clear_cache()
        st.rerun()

    st.divider()
    st.markdown("Select a project to assign to the selected files.")
    projects = requests.get("http://back:80/projects").json()

    selected_projects = st.multiselect(
        "Select Project",
        options=[project["name"] for project in projects],
        key=f"select_project_{key}",
    )

    cols = st.columns(2)
    with cols[0]:
        if st.button(
            "Assign Projects 🟢",
            use_container_width=True,
            key=f"assign_project_{key}",
            disabled=len(selected_projects) == 0,
        ):
            error_files = []
            with st.spinner("Assigning projects to files..."):
                for file in files:
                    for selected_project in selected_projects:
                        result = requests.post(
                            f"http://back:80/project/{selected_project}/file?file={file}",
                        )
                        if result.status_code != 200:
                            st.error(
                                f"Failed to assign project to {os.path.basename(file)}."
                            )
                            if file not in error_files:
                                error_files.append(file)
            toast_for_rerun(
                f"Project '{selected_project}' assigned to {len(files)} files.",
                icon="📂",
            )
            clear_cache()
            st.rerun()

    with cols[1]:
        if st.button(
            "Unassign Projects ❌",
            use_container_width=True,
            key=f"unassign_project_{key}",
            disabled=len(selected_projects) == 0,
        ):
            error_files = []
            with st.spinner("Unassigning projects from files..."):
                for file in files:
                    for selected_project in selected_projects:
                        result = requests.delete(
                            f"http://back:80/project/{selected_project}/file?file={file}",
                        )
                        if result.status_code != 200:
                            st.error(
                                f"Failed to unassign project from {os.path.basename(file)}."
                            )
                            if file not in error_files:
                                error_files.append(file)
            toast_for_rerun(
                f"Project '{selected_project}' unassigned from {len(files)} files.",
                icon="📂",
            )
            clear_cache()
            st.rerun()


@st.dialog("🏷️ Edit Tags", width="small")
def edit_tags_dialog(files, key="edit_tags"):
    """
    Dialog for editing the tags of selected files.
    """
    st.info(f"{len(files)} selected files.")

    if st.button(
        "Clear all tags of all files 🗑️",
        use_container_width=True,
        key=f"clear_tags_{key}",
    ):
        error_files = []
        with st.spinner("Clearing tags of files..."):
            for file in files:
                tag_files = requests.get(f"http://back:80/tags_of/{file}").json()
                for tag in tag_files:
                    result = requests.delete(
                        f"http://back:80/tag/{tag['name']}/file?file={file}"
                    )
                    if result.status_code != 200:
                        if file not in error_files:
                            st.error(
                                f"Failed to clear tag for {os.path.basename(file)}."
                            )
                    error_files.append(file)
        if len(error_files) == 0:
            toast_for_rerun(
                f"Tags cleared for {len(files)} files.",
                icon="🏷️",
            )
        else:
            toast_for_rerun(
                f"Failed to clear tags for {len(error_files)} files. Tags cleared for {len(files) - len(error_files)} files.",
                icon="⚠️",
            )
        clear_cache()
        st.rerun()

    st.divider()
    st.markdown("Select a tag to assign to the selected files.")
    tags = requests.get("http://back:80/tags").json()

    selected_tags = st.multiselect(
        "Select Tag",
        options=[tag["name"] for tag in tags],
        key=f"select_tag_{key}",
    )

    cols = st.columns(2)
    with cols[0]:
        if st.button(
            "Assign Tags 🟢",
            use_container_width=True,
            key=f"assign_tag_{key}",
            disabled=len(selected_tags) == 0,
        ):
            error_files = []
            with st.spinner("Assigning tags to files..."):
                for file in files:
                    for selected_tag in selected_tags:
                        result = requests.post(
                            f"http://back:80/tag/{selected_tag}/file?file={file}",
                        )
                        if result.status_code != 200:
                            st.error(
                                f"Failed to assign tag to {os.path.basename(file)}."
                            )
                            if file not in error_files:
                                error_files.append(file)
            if len(error_files) == 0:
                toast_for_rerun(
                    f"Tag '{selected_tag}' assigned to {len(files)} files.",
                    icon="🏷️",
                )
            else:
                toast_for_rerun(
                    f"Failed to assign tag for {len(error_files)} files. Tag '{selected_tag}' assigned to {len(files) - len(error_files)} files.",
                    icon="⚠️",
                )
            clear_cache()
            st.rerun()
    with cols[1]:
        if st.button(
            "Unassign Tags ❌",
            use_container_width=True,
            key=f"unassign_tag_{key}",
            disabled=len(selected_tags) == 0,
        ):
            error_files = []
            with st.spinner("Unassigning tags from files..."):
                for file in files:
                    for selected_tag in selected_tags:
                        result = requests.delete(
                            f"http://back:80/tag/{selected_tag}/file?file={file}",
                        )
                        if result.status_code != 200:
                            st.error(
                                f"Failed to unassign tag from {os.path.basename(file)}."
                            )
                            if file not in error_files:
                                error_files.append(file)
            if len(error_files) == 0:
                toast_for_rerun(
                    f"Tag '{selected_tag}' unassigned from {len(files)} files.",
                    icon="🏷️",
                )
            else:
                toast_for_rerun(
                    f"Failed to unassign tag for {len(error_files)} files. Tag '{selected_tag}' unassigned from {len(files) - len(error_files)} files.",
                    icon="⚠️",
                )
            clear_cache()
            st.rerun()


@st.dialog("✨ AI Actions", width="small")
def ai_actions_dialog(files, key="ai_actions"):
    if st.button(
        "🧠 Generate Summary",
        use_container_width=True,
        key=f"generate_summary_{key}",
    ):
        with st.spinner("Asking summary for files..."):
            error_files = []
            for file in files:
                result = requests.post(f"http://back:80/summarize/ask/{file}")
                if result.status_code != 200:
                    error_files.append(file)
            if len(error_files) == 0:
                toast_for_rerun(
                    f"Summary asked for {len(files)} files.",
                    icon="🧠",
                )
            else:
                toast_for_rerun(
                    f"Failed to ask summary for {len(error_files)} files. Summary asked for {len(files) - len(error_files)} files.",
                    icon="⚠️",
                )
        st.rerun()

    if st.button(
        "🔍 Generate OCR",
        use_container_width=True,
        key=f"generate_ocr_{key}",
    ):
        with st.spinner("Asking OCR for files..."):
            asked_files = [
                file for file in files if guess_mime(file).startswith("image/")
            ]
            error_files = []
            for file in asked_files:
                result = requests.post(f"http://back:80/ocr/ask/{file}")
                if result.status_code != 200:
                    error_files.append(file)
            if len(error_files) == 0:
                toast_for_rerun(
                    f"OCR asked for {len(files)} files.",
                    icon="🔍",
                )
            else:
                toast_for_rerun(
                    f"Failed to ask OCR for {len(error_files)} files. OCR asked for {len(files) - len(error_files)} files.",
                    icon="⚠️",
                )
        st.rerun()

    if st.button(
        "🎤 Generate Transcription",
        use_container_width=True,
        key=f"generate_transcription_{key}",
    ):
        with st.spinner("Asking transcription for files..."):
            asked_files = [
                file
                for file in files
                if guess_mime(file).startswith("audio/")
                or guess_mime(file).startswith("video/")
            ]
            error_files = []
            for file in asked_files:
                result = requests.post(f"http://back:80/transcribe/ask/{file}")
                if result.status_code != 200:
                    error_files.append(file)
            if len(error_files) == 0:
                toast_for_rerun(
                    f"Transcription asked for {len(files)} files.",
                    icon="🎤",
                )
            else:
                toast_for_rerun(
                    f"Failed to ask transcription for {len(error_files)} files. Transcription asked for {len(files) - len(error_files)} files.",
                    icon="⚠️",
                )
        st.rerun()


multiple_selection_options = ["🔎 View", "📦 Select"]


def multi_select_menu(
    key: str = "multi_select", default_mode: int = 0, disable_pill: bool = False
):
    cols = st.columns([2, 4, 1, 1, 1, 1, 1, 1])
    with cols[0]:
        if disable_pill:
            interact_mode = multiple_selection_options[default_mode]
        else:
            interact_mode = st.pills(
                "Interaction Mode",
                multiple_selection_options,
                default=multiple_selection_options[default_mode],
                key=f"{key}_interaction_mode",
            )
            if interact_mode not in multiple_selection_options:
                interact_mode = multiple_selection_options[0]

    select_default_value = False
    if interact_mode == multiple_selection_options[1]:
        with cols[0 if disable_pill else 1]:
            if not disable_pill:
                spacer()
            select_default_value = st.checkbox(
                "📦 All", value=True, key=f"multiselect_select_default_{key}"
            )

    return interact_mode, select_default_value, cols


def multi_select_actions_menu(selected_files, key: str = "multi_select", cols=None):
    if cols is None:
        cols = st.columns([0, 0, 1, 1, 1, 1, 1, 1])
    with cols[2]:
        spacer(25)
        if st.button(
            "🗑️ Delete",
            use_container_width=True,
            key=f"{key}_delete",
            disabled=len(selected_files) == 0,
        ):
            delete_files_dialog(selected_files)
    with cols[3]:
        spacer(25)
        if st.button(
            "📂 Edit Project",
            use_container_width=True,
            key=f"{key}_edit_project",
            disabled=len(selected_files) == 0,
        ):
            edit_project_dialog(selected_files, key=f"{key}_edit_project")
    with cols[4]:
        spacer(25)
        if st.button(
            "🏷️ Edit Tags",
            use_container_width=True,
            key=f"{key}_edit_tags",
            disabled=len(selected_files) == 0,
        ):
            edit_tags_dialog(selected_files, key=f"{key}_edit_tags")
    with cols[5]:
        spacer(25)
        if st.button(
            "📥 Download All",
            use_container_width=True,
            key=f"{key}_download_all",
            disabled=len(selected_files) == 0,
        ):
            # TODO implement download all files
            pass
    with cols[6]:
        spacer(25)
        if st.button(
            "🖼️ Generate Previews",
            use_container_width=True,
            key=f"{key}_generate_previews",
            disabled=len(selected_files) == 0,
        ):
            errors = []
            for file in selected_files:
                result = requests.post(f"http://back:80/preview/generate/{file}")
                if result.status_code not in (200, 500):
                    errors.append(file)
            if errors:
                toast_for_rerun(
                    f"Failed to queue preview for {len(errors)} file(s).",
                    icon="⚠️",
                )
            else:
                toast_for_rerun(
                    f"Preview generation queued for {len(selected_files)} file(s).",
                    icon="🖼️",
                )
    with cols[7]:
        spacer(25)
        if st.button(
            "✨ AI actions",
            use_container_width=True,
            key=f"{key}_ai_actions",
            disabled=len(selected_files) == 0,
        ):
            ai_actions_dialog(selected_files)


def table_files(
    files,
    multi_select_mode: bool = False,
    allow_actions: bool = True,
    key: str = "table",
):
    # MARK: TABLE FILES
    interact_mode, select_default_value, multi_select_cols = multi_select_menu(
        key=key,
        default_mode=multi_select_mode if multi_select_mode is not None else 0,
        disable_pill=multi_select_mode is not None,
    )

    table = pd.DataFrame(
        [
            {
                "see": select_default_value,
                "File": os.path.basename(file),
                "Date": file.split("/")[2],
                "Subfolder": file.split("/")[3],
                "Projects": ", ".join(
                    [
                        p["name"]
                        for p in requests.get(
                            f"http://back:80/projects_of/{file}"
                        ).json()
                    ]
                ),
                "Tags": ", ".join(
                    [
                        t["name"]
                        for t in requests.get(f"http://back:80/tags_of/{file}").json()
                    ]
                ),
            }
            for file in files
        ]
    )

    table = st.data_editor(
        table,
        column_config={
            "see": st.column_config.CheckboxColumn(
                "🔎" if interact_mode == multiple_selection_options[0] else "📦",
                default=select_default_value,
            )
        },
        use_container_width=True,
        hide_index=True,
        disabled=["File", "Date", "Subfolder", "Path"],
        key=f"{key}_lines",
    )
    selected_rows = table.query("see == True")
    if interact_mode == multiple_selection_options[0]:
        if len(selected_rows) > 0:
            st.session_state.file_to_see = f"/shared/{selected_rows.iloc[0]['Date']}/{selected_rows.iloc[0]['Subfolder']}/{selected_rows.iloc[0]['File']}"
            st.switch_page(PAGE_VIEWER)
    else:
        files = [
            f"/shared/{row['Date']}/{row['Subfolder']}/{row['File']}"
            for _, row in selected_rows.iterrows()
        ]
        if allow_actions:
            multi_select_actions_menu(files, key=key, cols=multi_select_cols)
        return files
    return None


def box_file(
    file: str,
    height: int,
    show_preview: bool,
    select_mode: bool = False,
    select_default_value: bool = False,
    key: str = "",
):
    # MARK: BOX FILE
    selected = None
    with st.container(border=True, height=height):
        preview_container = st.container(
            border=True,
            height=height // 2,
        )
        file_name = os.path.basename(file)
        date = file.split("/")[2]
        subfolder = file.split("/")[3]

        if select_mode:
            selected = st.checkbox(
                "📦 Select",
                value=select_default_value,
                key=f"{key}_select_{file}",
            )
        cols = st.columns(2)
        st.markdown(f"##### {file_name}")
        st.caption(
            f"**📅 Date:** {date}<br/>**📁 Subfolder:** {subfolder}",
            unsafe_allow_html=True,
        )
        projects = requests.get(f"http://back:80/projects_of/{file}").json()
        tags = requests.get(f"http://back:80/tags_of/{file}").json()
        if projects:
            st.markdown(
                generate_aside_project_markdown(
                    [p["name"] for p in projects],
                    [p["color"] for p in projects],
                ),
                unsafe_allow_html=True,
            )
        if tags:
            st.markdown(
                generate_aside_tag_markdown(
                    [t["name"] for t in tags],
                    [t["color"] for t in tags],
                ),
                unsafe_allow_html=True,
            )

        with cols[0]:
            if st.button(
                "🔎",
                help="Click to view file details.",
                use_container_width=True,
                key=f"{key}_view_{file}",
            ):
                st.session_state.file_to_see = file
                st.switch_page(PAGE_VIEWER)
        with cols[1]:
            download_file_button(file)
    return preview_container, selected


def boxes_files(
    files,
    nbr_of_files_per_line: int,
    multi_select_mode: bool = False,  # None to be able to switch
    allow_actions: bool = True,
    show_preview: bool = False,
    key: str = "boxes_files",
):
    interact_mode, select_default_value, multi_select_cols = multi_select_menu(
        key=key,
        default_mode=multi_select_mode if multi_select_mode is not None else 0,
        disable_pill=multi_select_mode is not None,
    )
    selected_files = []

    file_preview_containers = []
    cols = st.columns(nbr_of_files_per_line)
    for i, file in enumerate(files):
        with cols[i % nbr_of_files_per_line]:
            preview_container, selected = box_file(
                file,
                height=600 if show_preview else 400,
                show_preview=show_preview,
                select_mode=interact_mode == multiple_selection_options[1],
                select_default_value=select_default_value,
                key=key,
            )
            file_preview_containers.append(preview_container)
            if selected:
                selected_files.append(file)
    for i, file_preview_container in enumerate(file_preview_containers):
        with file_preview_container:
            if show_preview:
                download_and_display_file(files[i], default_height_if_needed=250)
            else:
                download_and_display_preview(files[i])

    if interact_mode == multiple_selection_options[1] and allow_actions:
        multi_select_actions_menu(selected_files, key=key, cols=multi_select_cols)
    return selected_files


def line_file(
    file: str,
    show_preview: bool,
    select_mode: bool = False,
    select_default_value: bool = False,
    key: str = "",
):
    # MARK: LINE FILE
    selected = None
    with st.container(border=True):
        file_name = os.path.basename(file)
        date = file.split("/")[2]
        subfolder = file.split("/")[3]

        cols = st.columns([2, 2, 3, 1])
        with cols[1]:
            st.markdown(f"#### {file_name}")
            st.caption(
                f"**📅 Date:** {date}<br/>**📁 Subfolder:** {subfolder}",
                unsafe_allow_html=True,
            )
            projects = requests.get(f"http://back:80/projects_of/{file}").json()
            tags = requests.get(f"http://back:80/tags_of/{file}").json()
            if projects:
                st.markdown(
                    generate_aside_project_markdown(
                        [p["name"] for p in projects],
                        [p["color"] for p in projects],
                    ),
                    unsafe_allow_html=True,
                )
            if tags:
                st.markdown(
                    generate_aside_tag_markdown(
                        [t["name"] for t in tags],
                        [t["color"] for t in tags],
                    ),
                    unsafe_allow_html=True,
                )
        with cols[2]:
            result = requests.get(f"http://back:80/summarize/get/{file}")
            if result.status_code == 200 and result.json() is not None:
                summary = result.json().get("summary", "")
                keywords = result.json().get("keywords", [])
                st.caption(f"Keywords : {', '.join(keywords)}")
                with st.container(border=True, height=300):
                    st.markdown(summary)
            else:
                st.info("No summary available for this file.")
        with cols[3]:
            if select_mode:
                selected = st.checkbox(
                    "📦 Select",
                    value=select_default_value,
                    key=f"{key}_select_{file}",
                )
            if st.button(
                "🔎",
                help="Click to view file details.",
                use_container_width=True,
                key=f"{key}_view_{file}",
            ):
                st.session_state.file_to_see = file
                st.switch_page(PAGE_VIEWER)
            download_file_button(file)
        return cols[0].container(
            border=True,
            height=300,
        ), selected


def list_files(
    files,
    show_preview: bool = False,
    multi_select_mode: bool = False,  # None to be able to switch
    allow_actions: bool = True,
    key: str = "list_files",
):
    interact_mode, select_default_value, multi_select_cols = multi_select_menu(
        key=key,
        default_mode=multi_select_mode if multi_select_mode is not None else 0,
        disable_pill=multi_select_mode is not None,
    )
    selected_files = []

    file_preview_infos = []
    for file in files:
        preview_container, selected = line_file(
            file,
            show_preview=show_preview,
            select_mode=interact_mode == multiple_selection_options[1],
            select_default_value=select_default_value,
            key=key,
        )
        if selected:
            selected_files.append(file)
        file_preview_infos.append(preview_container)
    for i, file_preview_container in enumerate(file_preview_infos):
        if file_preview_container is None:
            continue
        with file_preview_container:
            if show_preview:
                download_and_display_file(files[i], default_height_if_needed=250)
            else:
                download_and_display_preview(files[i])

    if interact_mode == multiple_selection_options[1] and allow_actions:
        multi_select_actions_menu(selected_files, key=key, cols=multi_select_cols)
    return selected_files


def display_files(
    files,
    representation_mode: int,
    show_preview: bool = False,
    nbr_of_files_per_line: int = 3,
    multi_select_mode: bool = None,  # None to be able to switch
    allow_actions: bool = True,
    key="",
):
    selected_files = []
    if len(files) == 0:
        st.info("No files found.")
    elif representation_mode == 0:
        selected_files = table_files(
            files,
            multi_select_mode=multi_select_mode,
            allow_actions=allow_actions,
            key=key,
        )

    # MARK: BOXES
    elif representation_mode == 1:
        selected_files = boxes_files(
            files,
            multi_select_mode=multi_select_mode,
            allow_actions=allow_actions,
            nbr_of_files_per_line=nbr_of_files_per_line,
            show_preview=show_preview,
            key=key,
        )

    # MARK: LIST
    elif representation_mode == 2:
        selected_files = list_files(
            files,
            multi_select_mode=multi_select_mode,
            allow_actions=allow_actions,
            show_preview=show_preview,
            key=key,
        )

    if multi_select_mode is True or multi_select_mode is None:
        st.caption(f"Selected files: {len(selected_files)} / {len(files)}")

    return selected_files


def representation_mode_select(
    aside: bool = False, aside_offset: int = 0, default_mode: int = 1
):
    # MARK: REPRESENTATION MODE SELECT
    cols = st.columns([1, 1, 1, aside_offset]) if aside else st.columns(1)
    representation_options = ["🧮 Table", "🃏 Cards", "🏷️ List"]
    with cols[0]:
        representation_mode = st.segmented_control(
            "Representation",
            options=range(len(representation_options)),
            format_func=lambda x: representation_options[x],
            default=default_mode,
            key="representation",
        )
    if representation_mode is None:
        representation_mode = 1
    with cols[1 if aside else 0]:
        if representation_mode in [1, 2]:
            show_preview = st.toggle(
                "Detailed preview",
                value=False,
                help="Off: shows a small quick preview. On: loads the full file.",
            )
    with cols[2 if aside else 0]:
        if representation_mode == 1:
            nbr_of_files_per_line = st.slider(
                "Number of files per line",
                min_value=3,
                max_value=8,
                value=5,
                help="Adjust the number of files displayed per line.",
            )

    return (
        representation_mode,
        show_preview if representation_mode in [1, 2] else False,
        nbr_of_files_per_line if representation_mode == 1 else 3,
    )

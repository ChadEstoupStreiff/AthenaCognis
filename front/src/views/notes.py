import datetime
import json
import tempfile
import urllib.parse

import requests
import streamlit as st
from pages import PAGE_VIEWER
from utils import clear_cache, toast_for_rerun, refractor_text_area


def clear_selected_note():
    if "note_content" in st.session_state:
        del st.session_state["note_name"]
        del st.session_state["note_content"]


def notes():
    # MARK: LOADING
    with st.sidebar:
        with st.container(border=True):
            st.subheader("Load a note")
            note_date = st.date_input(
                "Notes of",
                help="Choose the date for the notes.",
                key="notes_date",
            )

            with st.container(border=True):
                if st.button("Create new note", use_container_width=True, type="primary"):
                    clear_cache()
                    new_note_name = datetime.datetime.now().strftime("%H-%M-%S")
                    st.session_state["note_name"] = (
                        f"/shared/{note_date}/notes/{new_note_name}.md"
                    )
                    st.session_state["note_content"] = "# 🚀 New note"
                    st.toast(
                        f"Note '{new_note_name}' created successfully.",
                        icon="✅",
                    )

                opened_note = st.selectbox(
                    "Select a note to view or edit",
                    [
                        n.split("/")[-1]
                        for n in requests.get(
                            f"http://back:80/files/search?subfolder=notes&start_date={note_date}&end_date={note_date}"
                        ).json()
                    ],
                    key="notes_selectbox",
                    help="Choose a note from the list to view or edit its content.",
                    on_change=clear_selected_note,
                )
                if "note_name" not in st.session_state and opened_note:
                    st.session_state["note_name"] = (
                        f"/shared/{note_date}/notes/{opened_note}"
                    )

    # MARK: NOTE CONTENT
    if "note_content" not in st.session_state and "note_name" in st.session_state:
        with st.spinner("Loading note...", show_time=True):
            file = st.session_state["note_name"]
            st.session_state["note_name"] = file
            note_content = requests.get(f"http://back:80/files/download/{file}")
            if note_content.status_code == 200:
                st.toast(
                    f"Note '{file}' loaded successfully.",
                    icon="✅",
                )
                st.session_state["note_content"] = note_content.text
            else:
                st.session_state["note_content"] = "# 🚀 New note"
                st.toast(
                    f"Note '{file}' not found. Starting with a new note.",
                    icon="❌",
                )

    # MARK: DETAILS
    if "note_name" in st.session_state:
        opened_note = st.session_state["note_name"]
        note_name = opened_note.split("/")[-1]

        with st.sidebar:
            st.info(f"Editing: {opened_note}")
            new_name = st.text_input(
                "Note name",
                value=note_name,
                help="Enter a new name for the note.",
                key="notes_rename_input",
            )
            if new_name != note_name:
                result = requests.post(
                    f"http://back:80/files/move/{opened_note}?name={new_name}",
                )
                if result.status_code == 200:
                    clear_cache()
                    st.session_state["note_name"] = result.json()
                    toast_for_rerun(
                        f"Note renamed to '{new_name}'.",
                        icon="✅",
                    )
                    st.rerun()
                else:
                    st.error(f"Failed to rename note: {result.text}")
                    st.toast(
                        f"Failed to rename note: {result.text}",
                        icon="❌",
                    )

            if st.button(
                "🔎 Open file",
                use_container_width=True,
                key="notes_viewer_button",
            ):
                st.session_state.file_to_see = opened_note
                st.switch_page(PAGE_VIEWER)
            st.divider()

    # MARK: SETTINGS
    if "note_content" in st.session_state and "note_name" in st.session_state:
        with st.sidebar:
            side_by_side = st.toggle("Side by Side", value=True)
            if side_by_side:
                editor_size = st.number_input(
                    "Editor height (px)",
                    min_value=300,
                    max_value=1800,
                    value=1100,
                    step=50,
                    help="Set the height of the editor in pixels.",
                )

        cols = st.columns(2 if side_by_side else 1)

        # MARK: CONTENT
        with cols[0]:
            markdown_input = refractor_text_area(
                "Edit note content",
                context="You need to write a note in markdown format. I like emojis and bullet points, so use them when appropriate.",
                value=st.session_state["note_content"],
                height=editor_size if side_by_side else None,
                key=f"notes_textarea_{opened_note}",
                label_visibility="hidden",
            )

        with cols[1 if side_by_side else 0]:
            with st.container(
                border=True, height=editor_size + 50 if side_by_side else None
            ):
                st.markdown(markdown_input, unsafe_allow_html=False)

        # MARK: SAVE
        if st.session_state["note_content"] != markdown_input:
            note_date = opened_note.split("/")[2]
            note_subdir = opened_note.split("/")[3]
            note_filename = opened_note.split("/")[-1]

            with st.sidebar:
                with tempfile.NamedTemporaryFile(
                    mode="w+", delete=True, suffix=".md"
                ) as tmpfile:
                    tmpfile.write(markdown_input)
                    tmpfile.flush()
                    tmpfile.seek(0)
                    tmpfile_path = tmpfile.name

                    # Construct file_edit_info automatically
                    file_edit_info = {
                        opened_note: {
                            "name": note_filename,
                            "date": note_date,
                        }
                    }

                    with open(tmpfile_path, "rb") as f:
                        files_payload = [("files", (opened_note, f, "text/markdown"))]
                        params = {
                            "subdirectory": note_subdir,
                            "file_edit_info": json.dumps(file_edit_info),
                        }
                        query = f"http://back:80/files/upload?{urllib.parse.urlencode(params)}"

                        response = requests.post(query, files=files_payload)

                    if response.status_code == 200:
                        st.toast(
                            f"Note '{opened_note}' saved successfully",
                            icon="✅",
                        )
                    else:
                        st.toast(
                            f"Failed to save note '{opened_note}'",
                            icon="❌",
                        )


if __name__ == "__main__":
    notes()

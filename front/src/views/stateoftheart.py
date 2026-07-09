import json
from typing import Any, Dict

import pandas
import requests
import streamlit as st
from core.explorer import generate_query_description, run_streaming_search, search_engine
from core.stateoftheart import (
    format_APA,
    format_BibTeX,
    format_Vancouver,
    get_reference_from_title,
)
from stqdm import stqdm
from utils import toast_for_rerun


def create_table_line(
    file: str, select_default_value: bool, display_projects: bool, display_tags: bool
) -> Dict[str, Any]:
    file_name = file.split("/")[-1]
    file_date = file.split("/")[2]
    stockpile_info = requests.get(
        f"http://back:80/stockpile/get/sota_info_{file_date}_{file_name}"
    )
    if stockpile_info.status_code == 200:
        try:
            info = json.loads(stockpile_info.json())
        except Exception:
            info = {}
    else:
        info = {}

    # Ensure 'validated' is present, defaulting to False
    if "validated" not in info:
        info["validated"] = False

    return {
        "select": select_default_value,
        "validated": info.get("validated", False),
        "Filename": file.split("/")[-1],
        "Upload Date": file.split("/")[2],
        **(
            {
                "Projects": [
                    p["name"]
                    for p in requests.get(f"http://back:80/projects_of/{file}").json()
                ]
            }
            if display_projects
            else {}
        ),
        **(
            {
                "Tags": [
                    t["name"]
                    for t in requests.get(f"http://back:80/tags_of/{file}").json()
                ]
            }
            if display_tags
            else {}
        ),
        **{k: v for k, v in info.items() if k != "validated"},
    }


@st.dialog("📈 State-of-the-art Management", width="large")
def edit_stateoftheart_dialog():
    def update_sota_info():
        # Keys that are NOT SOTA info but are metadata needed for the API call or display
        METADATA_KEYS = [
            "select",
            "Filename",
            "Upload Date",
            "Projects",
            "Tags",
        ]

        for i, file_data in enumerate(st.session_state.sota_selected_files_copy):
            # Ensure Filename and Upload Date are present before proceeding
            if "Filename" not in file_data or "Upload Date" not in file_data:
                st.toast(
                    f"Missing metadata for file at index {i}.",
                    icon="⚠️",
                )
                return

            file_name = file_data["Filename"]
            file_date = file_data["Upload Date"]
            file_key = f"{file_date}_{file_name}"

            # Filter file_data to only include SOTA info fields for saving
            sota_info_to_save = {
                k: v for k, v in file_data.items() if k not in METADATA_KEYS
            }

            # --- START OF FIX ---
            # Explicitly cast the 'validated' field (which might be numpy.bool_)
            # to a standard Python bool, which is JSON serializable.
            if "validated" in sota_info_to_save:
                sota_info_to_save["validated"] = bool(sota_info_to_save["validated"])
            # --- END OF FIX ---

            result = requests.post(
                # Use the filtered dictionary for saving
                f"http://back:80/stockpile/set/sota_info_{file_key}?value={json.dumps(sota_info_to_save)}",
            )
            if result.status_code != 200:
                st.toast(
                    f"Error while saving SOTA info for file {file_name}.",
                    icon="⚠️",
                )
                return  # Stop on first error
        del st.session_state.sota_selected_files_copy
        toast_for_rerun("SOTA info updated.", "✅")
        st.rerun()

    if "sota_selected_files_copy" not in st.session_state:
        st.session_state.sota_selected_files_copy = st.session_state.sota_selected_files
    if st.button("Save Changes", use_container_width=True, key="top_save_button", type="primary"):
        update_sota_info()
    for i, file_data in enumerate(st.session_state.sota_selected_files_copy):
        with st.expander(f"Edit File {i + 1}: {file_data['Filename']}", expanded=True):
            file_data["title"] = st.text_input(
                "Title",
                value=file_data.get("title", ""),
                key=f"title_{i}",
            )
            file_data["authors"] = st.text_input(
                "Authors",
                value=file_data.get("authors", ""),
                key=f"authors_{i}",
            )
            cols = st.columns(2)
            with cols[0]:
                # Note: `st.number_input` returns float by default, but you are saving it as part of a JSON string.
                # It is likely better to save it as an int, but the existing code uses `step=1.`.
                file_data["year"] = st.text_input(
                    "Year",
                    # Ensure the default value is present or correctly cast
                    value=file_data.get("year", "2023"),
                    key=f"year_{i}",
                )
            with cols[1]:
                file_data["source"] = st.text_input(
                    "Source",
                    value=file_data.get("source", ""),
                    key=f"source_{i}",
                )
            cols = st.columns(2)
            with cols[0]:
                file_data["url"] = st.text_input(
                    "URL",
                    value=file_data.get("url", ""),
                    key=f"url_{i}",
                )
            with cols[1]:
                file_data["doi"] = st.text_input(
                    "DOI",
                    value=file_data.get("doi", ""),
                    key=f"doi_{i}",
                )
            cols = st.columns(3)
            with cols[0]:
                file_data["volume"] = st.text_input(
                    "Volume",
                    value=file_data.get("volume", ""),
                    key=f"volume_{i}",
                )
            with cols[1]:
                file_data["issue"] = st.text_input(
                    "Issue",
                    value=file_data.get("issue", ""),
                    key=f"issue_{i}",
                )
            with cols[2]:
                file_data["pages"] = st.text_input(
                    "Pages",
                    value=file_data.get("pages", ""),
                    key=f"pages_{i}",
                )
    if st.button("Save Changes", use_container_width=True, key="bottom_save_button", type="primary"):
        update_sota_info()


def stateoftheart():
    tags = requests.get("http://back:80/tags").json()
    tags_name = [x["name"] for x in tags]
    sota_tag = requests.get("http://back:80/stockpile/get/sota_tag")

    if sota_tag.status_code != 200:
        sota_tag = None
    else:
        sota_tag = sota_tag.json()

    def update_sota_tag():
        selected_tag = st.session_state.sota_tag_selection
        if selected_tag is not None:
            requests.post(
                f"http://back:80/stockpile/set/sota_tag?value={selected_tag}",
            )
        else:
            requests.delete("http://back:80/stockpile/delete/sota_tag")
        toast_for_rerun("SOTA tag updated.", "✅")

    # --- Helper function for bulk validation update ---
    def update_validation_status(set_validated: bool):
        selected = (
            st.session_state.sota_selected_files
        )  # Use the previously calculated selection list

        if not selected:
            st.toast("No files selected to update.", icon="⚠️")
            return

        for file_data in stqdm(selected, desc=f"Setting validated to {set_validated}"):
            file_name = file_data["Filename"]
            file_date = file_data["Upload Date"]
            file_key = f"{file_date}_{file_name}"

            # Fetch existing info
            stockpile_info_req = requests.get(
                f"http://back:80/stockpile/get/sota_info_{file_date}_{file_name}"
            )
            existing_info = {}
            if stockpile_info_req.status_code == 200:
                try:
                    existing_info = json.loads(stockpile_info_req.json())
                except Exception:
                    pass

            # Update the validated status
            updated_info = {**existing_info, "validated": set_validated}

            result = requests.post(
                f"http://back:80/stockpile/set/sota_info_{file_key}?value={json.dumps(updated_info)}",
            )
            if result.status_code != 200:
                st.toast(
                    f"Error while saving SOTA info for file {file_name}.",
                    icon="⚠️",
                )
                return  # Stop on first error

        toast_for_rerun(f"Validation status updated to {set_validated}.", "✅")
        st.rerun()

    # --- Sidebar setup ---
    st.sidebar.selectbox(
        "SOTA Tag",
        options=tags_name,
        on_change=update_sota_tag,
        index=None
        if sota_tag is None or sota_tag not in tags_name
        else tags_name.index(sota_tag),
        key="sota_tag_selection",
        help="Select the tag corresponding to the State-of-the-art files.",
    )

    # --- Main Application Logic ---
    if sota_tag is None:
        st.warning("Please select a tag for State-of-the-art files.")
    else:
        search_params = search_engine(force_tags=[sota_tag], streaming=True)
        if search_params is not None:
            st.session_state.sota_files = run_streaming_search(search_params)

        if "sota_files" in st.session_state:
            query_str = generate_query_description(st.session_state.sota_files)
            st.caption(query_str)

            if len(st.session_state.sota_files["files"]) == 0:
                st.write("No files found in the system.")
            else:
                with st.sidebar:
                    st.divider()

                    select_default_value = st.toggle(
                        "Select all by default",
                        value=False,
                        help="If enabled, all files will be selected by default in the table below.",
                    )
                    display_projects = st.toggle(
                        "Display projects",
                        value=False,
                        help="If enabled, the projects associated with each file will be displayed.",
                    )
                    display_tags = st.toggle(
                        "Display tags",
                        value=False,
                        help="If enabled, the tags associated with each file will be displayed.",
                    )

                files = st.session_state.sota_files["files"]
                data_table = pandas.DataFrame.from_dict(
                    [
                        create_table_line(
                            f, select_default_value, display_projects, display_tags
                        )
                        for f in files
                    ]
                )

                # Determine the columns that contain SOTA info (editable/savable fields)
                info_columns = [
                    k
                    for k in data_table.columns
                    if k
                    not in ["select", "Filename", "Upload Date", "Projects", "Tags"]
                ]

                table = st.data_editor(
                    data_table,
                    column_config={
                        "select": st.column_config.CheckboxColumn(
                            "✏️",
                            width="small",
                            default=select_default_value,
                        ),
                        "validated": st.column_config.CheckboxColumn(  # MOVED: Now the second column
                            "✅",
                            width="small",
                            default=False,
                            help="Manual check to confirm information is correct.",
                        ),
                        "url": st.column_config.LinkColumn(
                            "URL",
                            width="small",
                            help="Link to the publication.",
                        ),
                        # "Upload Date": st.column_config.DateColumn(
                        #     "Upload Date",
                        #     width="small",
                        #     format="YYYY-MM-DD",
                        # ),
                        # "authors": st.column_config.TextColumn(
                        #     "Authors",
                        #     width="medium",
                        # ),
                        "year": st.column_config.NumberColumn(
                            "Year",
                            width="small",
                        ),
                    },
                    use_container_width=True,
                    hide_index=True,
                    # Ensure 'validated' is NOT in the disabled list
                    disabled=[
                        "Filename",
                        "Upload Date",
                        "Projects",
                        "Tags",
                    ],
                    key="sota_data_editor",
                )

                row_update = False
                for i in range(len(table)):
                    # Get the columns that represent the SOTA info for comparison and saving
                    original_series = data_table.iloc[i][info_columns]
                    edited_series = table.iloc[i][info_columns]
                    if not original_series.equals(edited_series):
                        edited_columns = [
                            k
                            for k in info_columns
                            if original_series.get(k) != edited_series.get(k)
                        ]
                        edited_changes = {
                            k: (original_series.get(k), edited_series.get(k))
                            for k in edited_columns
                        }
                        st.info(
                            f"Row {i + 1} has been modified. Saving changes... edited columns: {edited_columns} changes: {edited_changes}"
                        )
                        row_update = True
                        file = files[i]
                        file_name = file.split("/")[-1]
                        file_date = file.split("/")[2]
                        file_key = f"{file_date}_{file_name}"

                        result = requests.post(
                            f"http://back:80/stockpile/set/sota_info_{file_key}?value={json.dumps(edited_series.to_dict())}",
                        )
                        if result.status_code != 200:
                            st.error(f"Error while saving SOTA info for file {file}.")
                            st.stop()

                if row_update:
                    toast_for_rerun("SOTA updated.", "✅")
                    st.rerun()

                selected_table = table.query("select == True")
                st.caption(f"{len(selected_table)} files selected.")

                selected_files_data = [
                    {k: selected_table[k][i] for k in selected_table.columns}
                    for i in selected_table.index
                ]
                # Save selected data to session state for use by sidebar buttons
                st.session_state.sota_selected_files = selected_files_data

                with st.sidebar:
                    st.divider()
                    button_search = st.button(
                        "🔍 Find info",
                        use_container_width=True,
                        disabled=not selected_files_data,
                        type="primary",
                    )
                    button_format_apa = st.button(
                        "📚 Format APA",
                        use_container_width=True,
                        disabled=not selected_files_data,
                    )
                    button_format_vancouver = st.button(
                        "📚 Format Vancouver",
                        use_container_width=True,
                        disabled=not selected_files_data,
                    )
                    button_format_bibtex = st.button(
                        "📚 Format BibTeX",
                        use_container_width=True,
                        disabled=not selected_files_data,
                    )

                if button_search:
                    for file_data in stqdm(
                        selected_files_data, desc="Fetching SOTA info"
                    ):
                        file_name = file_data["Filename"]
                        file_date = file_data["Upload Date"]
                        file_key = f"{file_date}_{file_name}"
                        founded = get_reference_from_title(file_name)

                        if founded is not None:
                            # Fetch existing info to preserve any manual edits (e.g., custom fields)
                            stockpile_info_req = requests.get(
                                f"http://back:80/stockpile/get/sota_info_{file_date}_{file_name}"
                            )
                            existing_info = {}
                            if stockpile_info_req.status_code == 200:
                                try:
                                    existing_info = json.loads(
                                        stockpile_info_req.json()
                                    )
                                except Exception:
                                    pass

                            # Merge new data (founded) into existing data, and explicitly reset validation flag.
                            updated_info = {
                                **existing_info,
                                **founded,
                                "validated": False,
                            }

                            result = requests.post(
                                f"http://back:80/stockpile/set/sota_info_{file_key}?value={json.dumps(updated_info)}",
                            )
                            if result.status_code != 200:
                                st.toast(
                                    f"Error while saving SOTA info for file {file_name}.",
                                    icon="⚠️",
                                )

                    toast_for_rerun("SOTA info updated.", "✅")
                    st.rerun()
                if button_format_apa:
                    st.code(format_APA(selected_files_data))
                if button_format_vancouver:
                    st.code(format_Vancouver(selected_files_data))
                if button_format_bibtex:
                    st.code(format_BibTeX(selected_files_data))
                st.sidebar.divider()

            with st.sidebar:
                if st.button(
                    "✏️ Edit Selected",
                    use_container_width=True,
                    disabled="sota_selected_files" not in st.session_state
                    or not st.session_state.sota_selected_files,
                    help="Manually edit SOTA information for all selected papers.",
                ):
                    if "sota_selected_files_copy" in st.session_state:
                        del st.session_state.sota_selected_files_copy
                    edit_stateoftheart_dialog()
                st.button(
                    "✅ Validate Selected",
                    on_click=update_validation_status,
                    args=(True,),
                    use_container_width=True,
                    disabled="sota_selected_files" not in st.session_state
                    or not st.session_state.sota_selected_files,
                    help="Manually mark all selected papers as validated.",
                )
                st.button(
                    "❌ Unvalidate Selected",
                    on_click=update_validation_status,
                    args=(False,),
                    use_container_width=True,
                    disabled="sota_selected_files" not in st.session_state
                    or not st.session_state.sota_selected_files,
                    help="Manually mark all selected papers as NOT validated.",
                )
        else:
            st.info("Search for files first :)")


if __name__ == "__main__":
    stateoftheart()

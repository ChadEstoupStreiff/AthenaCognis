import streamlit as st
from core.explorer import (
    generate_query_description,
    run_streaming_search,
    search_engine,
)
from core.files import display_files, representation_mode_select
from utils import get_setting


def explorer():
    # MARK: SEARCH FORM
    search_params = search_engine(streaming=True)

    with st.sidebar:
        representation_mode, show_preview, nbr_of_files_per_line = (
            representation_mode_select(
                default_mode=get_setting("explorer_default_representation_mode")
            )
        )

    if search_params is not None:
        st.session_state.explorer_files = run_streaming_search(search_params)

    if "explorer_files" in st.session_state:
        query_str = generate_query_description(st.session_state.explorer_files)
        st.caption(query_str)

        if len(st.session_state.explorer_files["files"]) > 0:
            # MARK: TABLE
            display_files(
                st.session_state.explorer_files["files"],
                representation_mode=representation_mode,
                nbr_of_files_per_line=nbr_of_files_per_line,
                show_preview=show_preview,
            )
        else:
            st.write("No files found in the system.")
    elif search_params is None:
        st.info("Search for files first :)")


if __name__ == "__main__":
    explorer()

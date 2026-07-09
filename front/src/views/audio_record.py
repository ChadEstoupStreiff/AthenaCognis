import requests
import streamlit as st
from utils import clear_cache
from pages import PAGE_VIEWER
from utils import toast_for_rerun
def audio_record():
    audio_data = st.audio_input(
        label="Record Audio",
        key="audio_recorder",
    )
    date = st.date_input(
        "Select Date",
        help="Choose the date for the recorded audio.",
        key="audio_date",
    )

    if st.button("Save recorded audio", use_container_width=True, type="primary"):
        if audio_data:
            file_name = f"audio_{date.strftime('%Y-%m-%d')}.wav"
            files_payload = [
                (
                    "files",
                    (file_name, audio_data, "audio/wav"),
                )
            ]
            response = requests.post(
                "http://back:80/files/upload?subdirectory=audio&date=" + date.strftime("%Y-%m-%d"),
                files=files_payload,
            )
            if response.status_code == 200:
                clear_cache()

                toast_for_rerun(
                    "Audio recorded and uploaded successfully!",
                    icon="🆕",
                )
                st.session_state.file_to_see = f"/shared/{date.strftime('%Y-%m-%d')}/audio/{file_name}"
                st.switch_page(PAGE_VIEWER)
            else:
                st.toast(
                    "Failed to upload audio. Please try again.",
                    icon="❌",
                )
        else:
            st.warning("No audio recorded yet. Please record audio first.")


if __name__ == "__main__":
    audio_record()

import streamlit as st
from auth import Authentificator
from telemetry import get_consent, is_configured, send_daily_ping, should_send_today, show_consent_dialog
from pages import (
    PAGE_AUDIO_RECORD,
    PAGE_CALENDAR,
    PAGE_CHAT,
    PAGE_CONTACTS,
    PAGE_DASHBOARD,
    PAGE_EXPLORER,
    PAGE_SOTA,
    PAGE_NOTES,
    PAGE_ORGANIZATION,
    PAGE_PROJECTS,
    PAGE_QUICK_UPLOAD,
    PAGE_SETTINGS,
    PAGE_VIEWER,
)

if __name__ == "__main__":
    st.set_page_config(
        page_title="AthenaCognis",
        page_icon="/assets/logo.png",
        layout="wide",
    )

    if "toast_for_rerun" in st.session_state:
        for message, icon in st.session_state.toast_for_rerun:
            st.toast(message, icon=icon)
        del st.session_state.toast_for_rerun
        
    if Authentificator.try_loggin():
        if is_configured():
            consent = get_consent()
            if consent is None:
                show_consent_dialog()
            elif consent is True and should_send_today():
                with st.spinner("Syncing telemetry..."):
                    send_daily_ping()

        pg = st.navigation(
            {
                "": [
                    PAGE_DASHBOARD,
                    PAGE_EXPLORER,
                    PAGE_CALENDAR,
                    PAGE_ORGANIZATION,
                    PAGE_PROJECTS,
                    PAGE_CONTACTS,
                    PAGE_SOTA,
                    PAGE_CHAT,
                    PAGE_SETTINGS,
                ],
                "Quick inputs": [
                    PAGE_QUICK_UPLOAD,
                    PAGE_NOTES,
                    PAGE_AUDIO_RECORD,
                ],
                "Opened": [] if "file_to_see" not in st.session_state else [PAGE_VIEWER],
            },
            expanded=False,
            position="sidebar",
        )

        pg.run()

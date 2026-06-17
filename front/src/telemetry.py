from datetime import date
from dotenv import dotenv_values
import requests
import streamlit as st
from src.utils import get_setting, set_setting

BACK_URL = "http://back:80"


def _telemetry_url() -> str:
    return dotenv_values("/.env").get("TELEMETRY_SERVER_URL", "").rstrip("/")


def is_configured() -> bool:
    return bool(_telemetry_url())


def get_or_create_uuid() -> str | None:
    stored = get_setting("telemetry_uuid", None)
    if stored:
        return stored
    try:
        with st.spinner("Getting telemetry UUID..."):
            r = requests.get(f"{_telemetry_url()}/uuid", timeout=30)
            if r.status_code == 200:
                new_uuid = r.json().get("uuid", "")
                if new_uuid:
                    set_setting("telemetry_uuid", new_uuid)
                    return new_uuid
    except Exception:
        st.toast("Failed to get telemetry UUID. Telemetry will be disabled.", icon="⚠️")
    return None


def should_send_today() -> bool:
    last_sent = get_setting("telemetry_last_sent", None)
    return last_sent != str(date.today())


def _collect_data() -> dict | None:
    try:
        r = requests.get(f"{BACK_URL}/metrics", timeout=10)
        if r.status_code != 200:
            return None
        m = r.json()
        disk = m.get("disk_usage", {})
        return {
            "nbr_files": m.get("nbr_files", 0),
            "nbr_projects": m.get("nbr_projects", 0),
            "nbr_tags": m.get("nbr_tags", 0),
            "nbr_calendars": m.get("nbr_calendars", 0),
            "nbr_hours": round(m.get("nbr_hours", 0), 1),
            "nbr_summaries": m.get("nbr_summaries", 0),
            "nbr_links": m.get("nbr_links", 0),
            "nbr_contacts": m.get("nbr_contacts", 0),
            "nbr_tasks": m.get("nbr_tasks", 0),
            "nbr_kanban_boards": m.get("nbr_kanban_boards", 0),
            "nbr_validated_tasks": m.get("nbr_validated_tasks", 0),
            "files_without_tag": m.get("files_without_tag", 0),
            "files_without_project": m.get("files_without_project", 0),
            "disk_files_bytes": disk.get("files", 0),
        }
    except Exception:
        return None


def get_consent():
    """Returns True (enabled), False (disabled), or None (not yet decided)."""
    return get_setting("telemetry_enabled")


def send_daily_ping() -> bool:
    client_uuid = get_or_create_uuid()
    if not client_uuid:
        return False
    data = _collect_data()
    if data is None:
        return False
    try:
        r = requests.post(
            f"{_telemetry_url()}/data/{client_uuid}",
            json=data,
            timeout=10,
        )
        if r.status_code in (201, 409):
            set_setting("telemetry_last_sent", str(date.today()))
            return True
    except Exception:
        pass
    return False


@st.dialog("Help improve AthenaCognis")
def show_consent_dialog():
    st.markdown(
        "**AthenaCognis** can send anonymous usage statistics once a day to help "
        "the developer understand how the app is used. No personal data, file names, "
        "or content is ever collected."
    )
    st.markdown(
        "You can change your choice later in the **Settings** page. "
        "If you decline, no data will be sent."
    )
    st.markdown(
        "🙏 Please consider accepting telemetry to help improve AthenaCognis. It's a small contribution that makes a big difference! In fact, the number of users define if I can use AthenaCognis as a scientific contribution for my PhD Thesis, it will help me a lot :)"
    )
    with st.expander("What data is collected?"):
        st.markdown(
            """
If you accept, the following data will be sent once a day (aggregated and anonymous):

- Number of files, projects, tags
- Number of calendar records and hours tracked
- Number of AI summaries and file links generated
- Number of contacts, kanban boards, tasks, and validated tasks
- Storage used by your files (bytes)

Nothing else. No IP addresses, no user names, no file contents.
All aggregated stats are [publicly visible](""" + dotenv_values("/.env").get("TELEMETRY_DASHBOARD_URL", "#") + """).
            """
        )

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Accept", use_container_width=True, type="primary"):
            set_setting("telemetry_enabled", True)
            st.rerun()
    with col2:
        if st.button("Decline", use_container_width=True):
            set_setting("telemetry_enabled", False)
            st.rerun()

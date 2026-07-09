import streamlit as st

PAGE_DASHBOARD = st.Page(
    "views/dashboard.py",
    title="Dashboard",
    icon="🏠",
    url_path="dashboard",
    default=True,
)
PAGE_CALENDAR = st.Page(
    "views/calendar.py",
    title="Calendar",
    icon="📅",
    url_path="calendar",
)
PAGE_PROJECTS = st.Page(
    "views/projects.py",
    title="Projects",
    icon="🗂️",
    url_path="projects",
)
PAGE_ORGANIZATION = st.Page(
    "views/organization.py",
    title="Organization",
    icon="📋",
    url_path="organization",
)
PAGE_EXPLORER = st.Page(
    "views/explorer.py",
    title="Documents",
    icon="📂",
    url_path="explorer",
)
PAGE_SOTA = st.Page(
    "views/stateoftheart.py",
    title="State Of The Art",
    icon="📃",
    url_path="stateoftheart",
)
PAGE_VIEWER = st.Page(
    "views/view.py",
    title="Document",
    icon="🔎",
    url_path="view",
)
PAGE_NOTES = st.Page(
    "views/notes.py",
    title="Notes",
    icon="📝",
    url_path="notes",
)
PAGE_AUDIO_RECORD = st.Page(
    "views/audio_record.py",
    title="Audio Record",
    icon="🎤",
    url_path="audio_record",
)
PAGE_QUICK_UPLOAD = st.Page(
    "views/quick_upload.py",
    title="Quick Upload",
    icon="📤",
    url_path="quick_upload",
)
PAGE_CHAT = st.Page(
    "views/chat.py",
    title="Chat",
    icon="💬",
    url_path="chat",
)
PAGE_CONTACTS = st.Page(
    "views/contacts.py",
    title="Contacts",
    icon="👤",
    url_path="contacts",
)
PAGE_SETTINGS = st.Page(
    "views/settings.py",
    title="Settings",
    icon="⚙️",
    url_path="settings",
)

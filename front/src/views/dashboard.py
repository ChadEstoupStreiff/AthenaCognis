import concurrent.futures
import datetime

import requests
import streamlit as st
from core.files import display_files
from utils import fmt_bytes, spacer
from widgets import bar_widget, disk_widget
from dotenv import dotenv_values


def dashboard():
    """
    Render the dashboard page.
    """
    user_name = dotenv_values("/.env").get("USER_NAME", "User").lower().capitalize()
    st.write(f"Welcome to the AthenaCognis Dashboard, {user_name}!")
    today = datetime.date.today()
    cols = st.columns([2, 1])

    # Fire all HTTP requests in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        f_pinned = executor.submit(lambda: requests.get("http://back:80/pinned").json())
        f_metrics = executor.submit(lambda: requests.get("http://back:80/metrics").json())
        f_projects = executor.submit(lambda: requests.get("http://back:80/projects").json())
        f_tags = executor.submit(lambda: requests.get("http://back:80/tags").json())
        f_added = executor.submit(lambda: requests.get("http://back:80/stockpile/recentadded").json())
        f_opened = executor.submit(lambda: requests.get("http://back:80/stockpile/recentopened").json())
        f_today = executor.submit(
            lambda: requests.get(
                f"http://back:80/files/search?start_date={today}&end_date={today}"
            ).json()
        )
        f_week = executor.submit(
            lambda: requests.get(
                f"http://back:80/files/search?start_date={today - datetime.timedelta(days=7)}&end_date={today}"
            ).json()
        )

        # 1. Pinned files — first to display
        with cols[0]:
            pinned_files = f_pinned.result()
            if pinned_files:
                with st.expander(f"📌 Pinned files - {len(pinned_files)} files", expanded=True):
                    display_files(
                        pinned_files,
                        representation_mode=1,
                        multi_select_mode=0,
                        nbr_of_files_per_line=4,
                        key="pinned_files",
                    )

        # 2. Stats
        with cols[1]:
            with st.container(border=True):
                metrics = f_metrics.result()
                metric_cols = st.columns(3)
                with metric_cols[0]:
                    st.metric(
                        label="Total Files",
                        value=metrics.get("nbr_files", 0),
                        help="Total number of files processed by the system.",
                    )
                    st.metric(
                        label="Total Projects",
                        value=metrics.get("nbr_projects", 0),
                        help="Total number of projects created in the system.",
                    )
                    st.metric(
                        label="Total Tags",
                        value=metrics.get("nbr_tags", 0),
                        help="Total number of tags created in the system.",
                    )
                    st.metric(
                        label="Summaries",
                        value=metrics.get("nbr_summaries", 0),
                        help="Number of files with an AI-generated summary.",
                    )
                with metric_cols[1]:
                    st.metric(
                        label="Total Calendars Events",
                        value=metrics.get("nbr_calendars", 0),
                        help="Total number of calendar entries in the system.",
                    )
                    st.metric(
                        label="Total Hours",
                        value=metrics.get("nbr_hours", 0),
                        help="Total number of hours logged in the system.",
                    )
                    st.metric(
                        label="App Disk Usage",
                        value=fmt_bytes(
                            metrics.get("disk_usage", {}).get("back", 0)
                            + metrics.get("disk_usage", {}).get("ollama", 0)
                            + metrics.get("disk_usage", {}).get("mysql", 0)
                            + metrics.get("disk_usage", {}).get("files", 0)
                        ),
                        help="Total disk space used by the application. ( Cache + Ollama + Database + Files )",
                    )
                    st.metric(
                        label="Links",
                        value=metrics.get("nbr_links", 0),
                        help="Number of semantic links between files.",
                    )
                with metric_cols[2]:
                    st.metric(
                        label="Contacts",
                        value=metrics.get("nbr_contacts", 0),
                        help="Total number of contacts in the system.",
                    )
                    st.metric(
                        label="Kanban Tasks",
                        value=metrics.get("nbr_tasks", 0),
                        help="Total number of kanban tasks.",
                    )
                    st.metric(
                        label="Kanban Boards",
                        value=metrics.get("nbr_kanban_boards", 0),
                        help="Total number of kanban boards.",
                    )
                    st.metric(
                        label="Validated Tasks",
                        value=metrics.get("nbr_validated_tasks", 0),
                        help="Number of tasks marked as completed.",
                    )

                disk_widget(metrics.get("disk_usage", {}))
                spacer()
                bar_widget(
                    metrics.get("file_type_counts", {}),
                    title="Files by Type",
                )
                spacer()
                projects = f_projects.result()
                bar_widget(
                    metrics.get("files_per_project", {}),
                    colors={project["name"]: project["color"] for project in projects},
                    title="Files per Project",
                )
                spacer()
                tags = f_tags.result()
                bar_widget(
                    metrics.get("files_per_tag", {}),
                    colors={tag["name"]: tag["color"] for tag in tags},
                    title="Files per Tag",
                )

        # 3. Rest — file sections after pinned and stats are rendered
        with cols[0]:
            sub_cols = st.columns(2)
            with sub_cols[0]:
                added_files = f_added.result()
                with st.expander("Added files", expanded=True):
                    display_files(
                        added_files,
                        representation_mode=0,
                        multi_select_mode=0,
                        key="recent_added_files",
                    )
            with sub_cols[1]:
                opened_files = f_opened.result()
                with st.expander("Opened files", expanded=True):
                    display_files(
                        opened_files,
                        representation_mode=0,
                        multi_select_mode=0,
                        key="recent_opened_files",
                    )

            sub_cols = st.columns(2)
            with sub_cols[0]:
                today_files = f_today.result()
                with st.expander(f"Today files - {len(today_files)} files", expanded=True):
                    display_files(
                        today_files,
                        representation_mode=0,
                        multi_select_mode=0,
                        key="today_files",
                    )
            with sub_cols[1]:
                week_files = f_week.result()
                with st.expander(
                    f"Week files (7d) - {len(week_files)} files", expanded=True
                ):
                    display_files(
                        week_files,
                        representation_mode=0,
                        multi_select_mode=0,
                        key="week_files",
                    )


if __name__ == "__main__":
    dashboard()

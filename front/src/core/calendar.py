import datetime
import json

import requests
import streamlit as st
from core.contacts import render_contact_pills
from utils import generate_project_visual_markdown, toast_for_rerun, refractor_text_area


@st.dialog("✏️ Edit Record", width="large")
def dialog_edit_record(record):
    projects = [p["name"] for p in requests.get("http://back:80/projects").json()]
    all_contacts = requests.get("http://back:80/contacts").json()
    current_contact_ids = [c["id"] for c in record.get("contacts", [])]

    edited_title = st.text_input("Title", value=record.get("title", ""))
    edited_description = refractor_text_area(
        "Description", value=record.get("description", "")
    )
    edited_project = st.selectbox(
        "Project",
        options=projects,
        index=projects.index(record.get("project", projects[0])),
        help="Select a project for this record.",
    )
    edited_time_spent = st.number_input(
        "Time Spent (hours)", value=record.get("time_spent", 0.0), min_value=0.0
    )
    edited_location = st.text_input(
        "Location", value=record.get("location", ""), placeholder="Enter location"
    )
    edited_attendees = st.text_input(
        "Attendees",
        value=record.get("attendees", ""),
        placeholder="Enter attendees, separated by commas",
    )
    edited_contacts = st.multiselect(
        "Contacts",
        options=all_contacts,
        default=[c for c in all_contacts if c["id"] in current_contact_ids],
        format_func=lambda c: c["name"] + (f" — {c['company']}" if c.get("company") else ""),
    )
    edited_contact_ids = [c["id"] for c in edited_contacts]

    if st.button("✅ Save Changes", use_container_width=True, type="primary"):
        result = requests.put(
            f"http://back:80/calendar/record/{record['id']}",
            params={
                "title": edited_title,
                "project": edited_project,
                "time_spent": edited_time_spent,
                "description": edited_description,
                "location": edited_location,
                "attendees": edited_attendees,
                "contacts": json.dumps(edited_contact_ids),
            },
        )
        if result.status_code == 200:
            toast_for_rerun("Record updated successfully!", icon="✅")
            st.rerun()
        else:
            st.error(f"Failed to update record: {result.text}")

    if st.button("🗑️ Delete", use_container_width=True):
        result = requests.delete(
            f"http://back:80/calendar/record/{record['id']}",
        )
        if result.status_code == 200:
            toast_for_rerun("Record deleted successfully!", icon="🗑️")
            st.rerun()
        else:
            st.error(f"Failed to delete record: {result.text}")


def box_calendar_record(
    record,
    show_project: bool = True,
    show_date: bool = True,
    show_edit_button: bool = True,
):
    """
    Display a calendar record in a box format.
    """
    with st.container(border=True):
        project = record.get("project", [])
        date = (
            datetime.datetime.strptime(record["date"], "%Y-%m-%dT%H:%M:%S")
            if "date" in record
            else datetime.date.today()
        )
        title = record.get("title", "No Title")
        description = record.get("description", None)
        time_spent = record.get("time_spent", 0)
        location = record.get("location", None)
        attendees = record.get("attendees", None)

        if show_project:
            project = requests.get(f"http://back:80/project/{project}")
            if project.status_code == 200:
                project = project.json()
            else:
                project = {"name": "Unknown Project", "color": "#FFFFFF"}
        cols = st.columns([3, 1] if show_edit_button else [3])
        with cols[0]:
            st.markdown(f"### {title}")
        if show_edit_button:
            with cols[1]:
                if st.button(
                    "✏️", use_container_width=True, key=f"edit_button_{record['id']}"
                ):
                    dialog_edit_record(record)
        if show_project:
            st.markdown(
                f"**📌 Project:** {generate_project_visual_markdown(project['name'], project['color'])}",
                unsafe_allow_html=True,
            )
        if show_date:
            st.markdown(f"**📅 Date:** {date.strftime('%Y-%m-%d')}")
        st.markdown(f"**⏱️ Time Spent:** {time_spent} hours")

        if location:
            st.markdown(f"**📍 Location:** {location}")
        if attendees:
            st.markdown(f"**👥 Attendees:** {attendees}")
        contacts = record.get("contacts", [])
        if contacts:
            st.markdown("**👤 Contacts:**")
            render_contact_pills(contacts)
        if description:
            st.markdown("**🗒️ Description:**")
            st.markdown(description)


def search_calendars(
    query: str, start_date: datetime, end_date: datetime, project: str = None
):
    """
    Search for calendar records based on query, start date, end date, and optional project.
    """
    request = f"http://back:80/calendar/search?start_date={start_date}&end_date={end_date}"
    if query and len(query) > 0:
        request += f"&query={query}"
    if project:
        request += f"&project={project}"

    with st.spinner("Searching calendars...", show_time=True):
        start_time = datetime.datetime.now()
        result = requests.get(request)
        end_time = datetime.datetime.now()

    if result.status_code == 200:
        st.toast(
            f"Found {len(result.json())} calendar records matching the criteria.",
        )
        return {
            "query": query,
            "start_date": start_date,
            "end_date": end_date,
            "project": project,
            "records": result.json(),
            "time_spent": end_time - start_time,
        }
    else:
        st.error(f"Failed to search calendars: {result.text}")
        return {
            "query": query,
            "start_date": start_date,
            "end_date": end_date,
            "project": project,
            "records": [],
            "time_spent": -1,
        }


def search_engine():
    """
    Search engine for calendar records.
    """
    with st.form("calendar_search_form", clear_on_submit=False):
        query = st.text_input("Search Query", placeholder="Enter search terms")
        cols = st.columns(2)
        with cols[0]:
            dates = st.date_input(
                "Search by date",
                value=(
                    datetime.date.today() - datetime.timedelta(days=7),
                    datetime.date.today(),
                ),
                key="search_dates",
                help="Select a date to filter files.",
            )
        with cols[1]:
            project = st.selectbox(
                "Project",
                options=["All"]
                + [p["name"] for p in requests.get("http://back:80/projects").json()],
            )

        if st.form_submit_button("Search", use_container_width=True, help="Search for calendar records", type="primary"):
            return search_calendars(
                query, dates[0], dates[1], project if project != "All" else None
            )
import datetime
import json

import requests
import streamlit as st
from core.calendar import box_calendar_record
from core.files import display_files
from dateutil.relativedelta import relativedelta
from streamlit_elements import elements, mui, nivo
from utils import get_setting, refractor_text_area, toast_for_rerun


def shiny_progress_bar(
    progress: float,
    days_passed: int,
    total_days: int,
    color1: str = "#667eea",
    color2: str = "#f093fb",
):
    pct = progress * 100
    days_left = total_days - days_passed
    label = f"{days_left} days left ({pct:.2f}%)"
    width_pct = f"{pct:.4f}%"
    st.markdown(
        f"""
        <style>
        @keyframes shiny-shimmer {{
            0% {{ background-position: 0% center; }}
            100% {{ background-position: 200% center; }}
        }}
        .shiny-progress-wrap {{
            width: 100%;
            background: rgba(255,255,255,0.06);
            border-radius: 50px;
            padding: 3px;
            box-shadow: inset 0 2px 5px rgba(0,0,0,0.4);
            margin: 8px 0 4px 0;
        }}
        .shiny-progress-bar {{
            width: {width_pct};
            min-width: 80px;
            height: 23px;
            border-radius: 50px;
            background: linear-gradient(90deg, {color1} 0%, {color2} 50%, {color1} 100%);
            background-size: 200% 100%;
            animation: shiny-shimmer 4s linear infinite;
            display: flex;
            align-items: center;
            justify-content: right;
            color: white;
            font-size: 12.5px;
            font-weight: 700;
            letter-spacing: 0.03em;
            text-shadow: 0 1px 4px rgba(0,0,0,0.7);
            box-shadow: 0 3px 14px rgba(118,75,162,0.55), 0 0 22px rgba(79,172,254,0.3);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 0 16px;
        }}
        </style>
        <div class="shiny-progress-wrap">
            <div class="shiny-progress-bar">{label}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def pie_chart(records, key="calendar_pie_chart"):
    pie_data = {}
    for record in records:
        project = record["project"]
        time_spent = record["time_spent"]
        if project not in pie_data:
            pie_data[project] = 0.0
        pie_data[project] += time_spent
    pie_data = [{"id": k, "label": k, "value": v} for k, v in pie_data.items()]
    with elements(f"elements_{key}"):
        with mui.Box(key=f"box_{key}", sx={"height": 500}):
            nivo.Pie(
                data=pie_data,
                margin={"top": 40, "right": 80, "bottom": 80, "left": 80},
                innerRadius=0.5,
                padAngle=0.7,
                cornerRadius=3,
                activeOuterRadiusOffset=8,
                borderWidth=1,
                borderColor={"from": "color", "modifiers": [["darker", 0.2]]},
                arcLinkLabelsSkipAngle=10,
                arcLinkLabelsTextColor="#333333",
                arcLinkLabelsThickness=2,
                arcLinkLabelsColor={"from": "color"},
                arcLabelsSkipAngle=10,
                arcLabelsTextColor={
                    "from": "color",
                    "modifiers": [["darker", 2]],
                },
            )


def bar_chart(records, per: str = "month", key="calendar_bar_chart"):
    if not records:
        return

    # 1. Parse dates and identify the full range boundaries
    parsed_data = []
    for r in records:
        dt = datetime.datetime.strptime(r["date"], "%Y-%m-%dT%H:%M:%S").date()
        parsed_data.append({**r, "dt": dt})

    start_date = min(r["dt"] for r in parsed_data)
    end_date = max(r["dt"] for r in parsed_data)

    # 2. Build the continuous timeline skeleton
    # We use a dict where the key is a sortable string and value is the data object
    bar_data_map = {}
    all_projects = sorted(list(set(r["project"] for r in parsed_data)))

    current = start_date
    while current <= end_date:
        # Determine sortable key and pretty display label
        if per == "month":
            sort_key = current.strftime("%Y-%m")
            label = current.strftime("%b %Y")  # e.g., "Jan 2024"
            increment = relativedelta(months=1)
        elif per == "week":
            year, week, _ = current.isocalendar()
            sort_key = f"{year}-{week:02d}"
            label = f"W{week} {year}"
            increment = datetime.timedelta(weeks=7)  # Jump to next week
        else:
            sort_key = current.strftime("%Y-%m-%d")
            label = current.strftime("%d %b %Y")  # e.g., "01 Jan 2024"
            increment = datetime.timedelta(days=1)

        if sort_key not in bar_data_map:
            # Initialize entry with 0 for all known projects to avoid undefined values
            entry = {"period": label, "sort_key": sort_key}
            for p in all_projects:
                entry[p] = 0.0
            bar_data_map[sort_key] = entry

        current += increment

    # 3. Fill the skeleton with actual data
    for r in parsed_data:
        dt = r["dt"]
        if per == "month":
            s_key = dt.strftime("%Y-%m")
        elif per == "week":
            year, week, _ = dt.isocalendar()
            s_key = f"{year}-{week:02d}"
        else:
            s_key = dt.strftime("%Y-%m-%d")

        if s_key in bar_data_map:
            bar_data_map[s_key][r["project"]] += r["time_spent"]

    # 4. Sort the list by the sort_key to ensure chronological order
    formatted_data_list = [bar_data_map[k] for k in sorted(bar_data_map.keys())]

    # 5. Render Nivo Chart
    with elements(f"elements_{key}"):
        with mui.Box(key=f"box_{key}", sx={"height": 500}):
            nivo.Bar(
                data=formatted_data_list,
                keys=all_projects,
                indexBy="period",
                margin={"top": 50, "right": 130, "bottom": 70, "left": 60},
                padding=0.3,
                valueScale={"type": "linear"},
                indexScale={"type": "band", "round": True},
                colors={"scheme": "nivo"},
                borderColor={"from": "color", "modifiers": [["darker", 1.6]]},
                axisBottom={
                    "tickSize": 5,
                    "tickPadding": 5,
                    "tickRotation": -45,  # Rotated for better readability
                    "legend": "Period",
                    "legendPosition": "middle",
                    "legendOffset": 60,
                },
                axisLeft={
                    "tickSize": 5,
                    "tickPadding": 5,
                    "tickRotation": 0,
                    "legend": "Hours Spent",
                    "legendPosition": "middle",
                    "legendOffset": -50,
                },
                labelSkipWidth=12,
                labelSkipHeight=12,
                legends=[
                    {
                        "dataFrom": "keys",
                        "anchor": "bottom-right",
                        "direction": "column",
                        "translateX": 120,
                        "itemWidth": 100,
                        "itemHeight": 20,
                        "symbolSize": 20,
                    }
                ],
            )

def line_chart(records, per: str = "month", key = "calendar_line_chart"):
    if not records:
        return

    # 1. Parse dates and identify boundaries
    parsed_data = []
    for r in records:
        dt = datetime.datetime.strptime(r["date"], "%Y-%m-%dT%H:%M:%S").date()
        parsed_data.append({**r, "dt": dt})
    
    start_date = min(r["dt"] for r in parsed_data)
    end_date = max(r["dt"] for r in parsed_data)
    all_projects = sorted(list(set(r["project"] for r in parsed_data)))

    # 2. Build the continuous timeline skeleton (chronological keys)
    timeline_keys = []
    labels_map = {} # Maps sort_key -> Pretty Label
    
    current = start_date
    while current <= end_date:
        if per == "month":
            s_key = current.strftime("%Y-%m")
            label = current.strftime("%b %Y")
            increment = relativedelta(months=1)
        elif per == "week":
            year, week, _ = current.isocalendar()
            s_key = f"{year}-W{week:02d}"
            label = f"W{week} {year}"
            increment = datetime.timedelta(weeks=1)
        else:
            s_key = current.strftime("%Y-%m-%d")
            label = current.strftime("%d %b %Y")
            increment = datetime.timedelta(days=1)
        
        if s_key not in timeline_keys:
            timeline_keys.append(s_key)
            labels_map[s_key] = label
            
        current += increment

    timeline_keys.sort()

    # 3. Initialize data structure for Nivo Line: { project_name: { sort_key: value } }
    series_accumulator = {p: {k: 0.0 for k in timeline_keys} for p in all_projects}

    # 4. Populate with actual data
    for r in parsed_data:
        dt = r["dt"]
        project = r["project"]
        if per == "month":
            s_key = dt.strftime("%Y-%m")
        elif per == "week":
            year, week, _ = dt.isocalendar()
            s_key = f"{year}-W{week:02d}"
        else:
            s_key = dt.strftime("%Y-%m-%d")
        
        if s_key in series_accumulator[project]:
            series_accumulator[project][s_key] += r["time_spent"]

    # 5. Format for Nivo Line: List of {"id": project, "data": [{"x": label, "y": value}]}
    line_data = []
    for project in all_projects:
        project_series = {"id": project, "data": []}
        for s_key in timeline_keys:
            project_series["data"].append({
                "x": labels_map[s_key],
                "y": series_accumulator[project][s_key]
            })
        line_data.append(project_series)

    # 6. Render Nivo Line Chart
    with elements(f"elements_{key}"):
        with mui.Box(key=f"box_{key}", sx={"height": 500}):
            nivo.Line(
                data=line_data,
                margin={"top": 50, "right": 110, "bottom": 70, "left": 60},
                xScale={"type": "point"},
                yScale={
                    "type": "linear",
                    "min": "auto",
                    "max": "auto",
                    "stacked": False,
                    "reverse": False
                },
                axisTop=None,
                axisRight=None,
                axisBottom={
                    "tickSize": 5,
                    "tickPadding": 5,
                    "tickRotation": -45,
                    "legend": "Period",
                    "legendOffset": 60,
                    "legendPosition": "middle"
                },
                axisLeft={
                    "tickSize": 5,
                    "tickPadding": 5,
                    "tickRotation": 0,
                    "legend": "Hours Spent",
                    "legendOffset": -50,
                    "legendPosition": "middle"
                },
                pointSize={10},
                pointColor={"theme": "background"},
                pointBorderWidth={2},
                pointBorderColor={"from": "serieColor"},
                pointLabelYOffset={-12},
                useMesh={True}, # Enables hover tooltips easily
                legends=[{
                    "anchor": "bottom-right",
                    "direction": "column",
                    "justify": False,
                    "translateX": 100,
                    "translateY": 0,
                    "itemsSpacing": 0,
                    "itemDirection": "left-to-right",
                    "itemWidth": 80,
                    "itemHeight": 20,
                    "itemOpacity": 0.75,
                    "symbolSize": 12,
                    "symbolShape": "circle",
                    "symbolBorderColor": "rgba(0, 0, 0, .5)",
                    "effects": [{
                        "on": "hover",
                        "style": {
                            "itemBackground": "rgba(0, 0, 0, .03)",
                            "itemOpacity": 1
                        }
                    }]
                }]
            )


@st.dialog("🆕 Create Record", width="large")
def dialog_create_record(projects):
    new_record_title = st.text_input(
        "Title",
        placeholder="Enter title",
        help="Enter the title for this record.",
    )

    cols = st.columns(2)
    with cols[0]:
        new_record_project = st.selectbox(
            "Project",
            options=[p["name"] for p in projects],
            index=0,
            help="Select a project for this record.",
        )
    with cols[1]:
        new_record_date = st.date_input("Date")

    cols = st.columns(2)
    with cols[0]:
        new_start_time = st.time_input(
            "Start Time",
            value=None,
            step=datetime.timedelta(minutes=30),
            help="Select the start time for this record.",
        )
    with cols[1]:
        new_record_time_spent = st.number_input(
            "Time Spent (hours)",
            min_value=0.0,
            max_value=24.0,
            value=7.0,
            step=0.1,
            help="Enter the time spent on this record in hours.",
        )

    new_record_description = refractor_text_area("Description", height=100)
    new_record_location = st.text_input(
        "Location",
        placeholder="Enter location (optional)",
        help="Enter the location for this record (optional)",
    )

    new_record_attendees = st.text_input(
        "Attendees",
        placeholder="Enter attendees",
        help="Enter the attendees for this record, separated by commas.",
    )
    all_contacts = requests.get("http://back:80/contacts").json()
    new_record_contacts = st.multiselect(
        "Contacts",
        options=all_contacts,
        format_func=lambda c: c["name"] + (f" — {c['company']}" if c.get("company") else ""),
    )
    new_record_contact_ids = [c["id"] for c in new_record_contacts]

    if st.button("Save Record", use_container_width=True, type="primary"):
        if len(new_record_title) == 0:
            st.error("Title cannot be empty.")
            return
        params = {
            "project": new_record_project,
            "date": new_record_date,
            "title": new_record_title,
            "time_spent": new_record_time_spent,
        }
        if new_record_description:
            params["description"] = new_record_description
        if new_record_location:
            params["location"] = new_record_location
        if new_record_attendees:
            params["attendees"] = new_record_attendees
        if new_start_time:
            params["start_time"] = new_start_time.strftime("%H:%M:%S")
        if new_record_contact_ids:
            params["contacts"] = json.dumps(new_record_contact_ids)
        response = requests.post("http://back:80/calendar/record", params=params)
        if response.status_code == 200:
            toast_for_rerun(
                "Record created successfully!",
                icon="🆕",
            )
            st.rerun()
        else:
            st.error(f"Error creating record: {response.text}")


def box_date(date, prefetched_files=None, prefetched_records=None):
    if prefetched_files is not None:
        files = prefetched_files
        error_files = None
    else:
        resp = requests.get(
            f"http://back:80/files/search?start_date={date}&end_date={date}"
        )
        error_files = None
        if resp.status_code == 200:
            files = resp.json()
        else:
            error_files = resp.text
            files = []

    if prefetched_records is not None:
        records = prefetched_records
        error_records = None
    else:
        resp = requests.get(
            f"http://back:80/calendar/search?start_date={date}&end_date={date}"
        )
        error_records = None
        if resp.status_code == 200:
            records = resp.json()
        else:
            error_records = resp.text
            records = []

    target_hourly_working_time = get_setting("target_hourly_working_time") or 7.5

    def find_emoji_for_time_spent(hours, date):
        if date > datetime.date.today():
            return ""
        elif date == datetime.date.today():
            return "🫡 "
        else:
            if hours == 0:
                return "⚠️ "
            if (
                hours >= target_hourly_working_time - 1
                and hours <= target_hourly_working_time + 1
            ):
                return "✅ "
            elif hours > target_hourly_working_time + 1:
                return "🔥 "
            else:
                return "🛌 "

    with st.expander(
        find_emoji_for_time_spent(sum([r["time_spent"] for r in records]), date)
        + date.strftime("%Y-%m-%d")
        + f" - **{len(records)}** records, **{len(files)}** files, **{sum([r['time_spent'] for r in records])}** hours",
        expanded=False,
    ):
        tabs = st.tabs([f"📅 Records: {len(records)}", f"📁 Files: {len(files)}"])
        with tabs[0]:
            st.error(
                f"Error fetching records: {error_records}"
            ) if error_records else None
            if records:
                for record in records:
                    box_calendar_record(record, show_date=False)
            else:
                st.info("No records found for this date.")
        with tabs[1]:
            st.error(f"Error fetching files: {error_files}") if error_files else None
            if files:
                display_files(
                    files,
                    representation_mode=0,
                    multi_select_mode=0,
                    show_preview=False,
                    key=f"files_for_date_{date}",
                )
            else:
                st.info("No files found for this date.")


def calendar():
    projects = requests.get("http://back:80/projects").json()

    if "calendar_month" not in st.session_state:
        st.session_state.calendar_month = datetime.datetime.now().month - 1
    if "calendar_year" not in st.session_state:
        st.session_state.calendar_year = datetime.datetime.now().year

    def prev_month():
        if st.session_state.calendar_month == 0:
            st.session_state.calendar_month = 11
            st.session_state.calendar_year -= 1
        else:
            st.session_state.calendar_month -= 1

    def next_month():
        if st.session_state.calendar_month == 11:
            st.session_state.calendar_month = 0
            st.session_state.calendar_year += 1
        else:
            st.session_state.calendar_month += 1

        
    pb_enabled = get_setting("calendar_progress_bar_enabled")
    if pb_enabled is None:
        pb_enabled = True
    with st.sidebar:
        if st.button("🆕 Create Record", use_container_width=True, type="primary"):
            dialog_create_record(projects)
            
        if pb_enabled:
            enable_progress_bar = st.toggle("Enable Progress Bar", value=True)
        enable_weekends = st.toggle("Enable Weekends", value=False)

    if pb_enabled and enable_progress_bar:
        pb_title = get_setting("calendar_progress_bar_title") or "PhD Progress"
        pb_start_str = get_setting("calendar_progress_bar_start_date") or "2025-11-01"
        pb_end_str = get_setting("calendar_progress_bar_end_date") or "2028-10-31"
        today = datetime.date.today()
        pb_start = datetime.date.fromisoformat(pb_start_str)
        pb_end = datetime.date.fromisoformat(pb_end_str)
        total_days = (pb_end - pb_start).days
        days_passed = (today - pb_start).days
        progress = max(0.0, min(1.0, days_passed / total_days))
        pb_color1 = get_setting("calendar_progress_bar_color1") or "#667eea"
        pb_color2 = get_setting("calendar_progress_bar_color2") or "#f093fb"
        shiny_progress_bar(progress, days_passed, total_days, pb_color1, pb_color2)
        st.caption(f"{pb_title}: {today} -> {pb_end} | {days_passed} / {total_days} days | {total_days - days_passed} days left | {progress:.2%} complete")

    tab_calendar, tab_stats = st.tabs(["📅 Calendar", "📊 Statistics"])

    with tab_calendar:

        nav_cols = st.columns([1, 2, 1, 1, 2, 1])
        with nav_cols[0]:
            st.button("◀ Previous", on_click=prev_month, use_container_width=True)
        with nav_cols[2]:
            st.selectbox(
                "Month",
                options=range(12),
                format_func=lambda x: [
                    "January", "February", "March", "April",
                    "May", "June", "July", "August",
                    "September", "October", "November", "December",
                ][x],
                key="calendar_month",
                label_visibility="collapsed",
            )
        with nav_cols[3]:
            st.number_input(
                "Year",
                min_value=0,
                max_value=5000,
                step=1,
                key="calendar_year",
                label_visibility="collapsed",
            )
        with nav_cols[5]:
            st.button("Next ▶", on_click=next_month, use_container_width=True)

        selected_month = st.session_state.calendar_month
        selected_year = st.session_state.calendar_year

        cols = st.columns(7 if enable_weekends else 5)
        for i in range(7 if enable_weekends else 5):
            with cols[i]:
                st.write(
                    f"""### **{
                        [
                            "Monday",
                            "Tuesday",
                            "Wednesday",
                            "Thursday",
                            "Friday",
                            "Saturday",
                            "Sunday",
                        ][i]
                    }**"""
                )
        start_date = datetime.date(selected_year, selected_month + 1, 1)
        month_end = (start_date + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)

        all_files_resp = requests.get(
            f"http://back:80/files/search?start_date={start_date}&end_date={month_end}"
        )
        all_records_resp = requests.get(
            f"http://back:80/calendar/search?start_date={start_date}&end_date={month_end}"
        )

        files_by_date = {}
        if all_files_resp.status_code == 200:
            for f in all_files_resp.json():
                # f is a path string: /shared/YYYY-MM-DD/subfolder/filename
                day = f.split("/")[2][:10]
                files_by_date.setdefault(day, []).append(f)

        records_by_date = {}
        if all_records_resp.status_code == 200:
            for r in all_records_resp.json():
                day = str(r.get("date", ""))[:10]
                records_by_date.setdefault(day, []).append(r)

        start_date_offset = start_date.weekday()
        for i in range(6):
            cols = st.columns(7 if enable_weekends else 5)
            for j in range(7 if enable_weekends else 5):
                if i * 7 + j >= start_date_offset:
                    date = start_date + datetime.timedelta(
                        days=i * 7 + j - start_date_offset
                    )
                    if date.month == selected_month + 1:
                        date_str = date.strftime("%Y-%m-%d")
                        with cols[j]:
                            box_date(
                                date,
                                prefetched_files=files_by_date.get(date_str, []),
                                prefetched_records=records_by_date.get(date_str, []),
                            )

    with tab_stats:
        with st.form("calendar stat form"):
            cols = st.columns(2)
            with cols[0]:
                stat_start_date = st.date_input(
                    "Start Date",
                    value=datetime.date(
                        selected_year,
                        selected_month + 1,
                        1,
                    ),
                )
            with cols[1]:
                stat_end_date = st.date_input(
                    "End Date",
                    value=datetime.date(
                        selected_year,
                        selected_month + 1,
                        1,
                    )
                    + datetime.timedelta(days=30),
                )
            submitted = st.form_submit_button(
                "Generate Statistics", use_container_width=True, type="primary"
            )
        if submitted:
            records = requests.get(
                f"http://back:80/calendar/search?start_date={stat_start_date}&end_date={stat_end_date}"
            )
            error_records = None
            if records.status_code == 200:
                records = records.json()
            else:
                error_records = records.text
                records = []
            if error_records:
                st.error(f"Error fetching records: {error_records}")
            else:
                if records:
                    pie_chart(records, key="calendar_pie_chart")
                    bar_chart(records, per="day", key="calendar_bar_chart_day")
                    # bar_chart(records, per="week", key="calendar_bar_chart_week")
                    bar_chart(records, per="month", key="calendar_bar_chart_month")
                    # line_chart(records, per="month", key="calendar_line_chart_month")
                    # line_chart(records, per="week", key="calendar_line_chart_week")
                    # line_chart(records, per="day", key="calendar_line_chart_day")
                else:
                    st.info("No records found for the selected date range.")


if __name__ == "__main__":
    calendar()

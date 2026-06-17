import os

import pandas as pd
import requests
import streamlit as st

TELEMETRY_SERVER_URL = os.getenv("TELEMETRY_SERVER_URL", "http://telemetry_server")

st.set_page_config(
    page_title="AthenaCognis — Telemetry",
    page_icon="📊",
    layout="wide",
)

st.title("📊 AthenaCognis — Public Telemetry")
st.caption(
    "All data is fully anonymised. No file names, content, or personal information is ever collected. "
    "Each instance is identified only by a randomly generated UUID."
)

st.divider()


@st.cache_data(ttl=300)
def fetch_stats():
    try:
        r = requests.get(f"{TELEMETRY_SERVER_URL}/stats", timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return None


data = fetch_stats()

if data is None:
    st.error("Could not reach the telemetry server.")
    st.stop()

summary = data.get("summary", {})
daily = data.get("daily", [])

# ── Summary metrics ──────────────────────────────────────────────────────────
col1, col2, col3 = st.columns(3)
col1.metric("All-time instances", summary.get("all_time_users", 0))
col2.metric("Average daily active instances", summary.get("avg_dau", 0))
col3.metric("Days tracked", summary.get("days_tracked", 0))

st.divider()

if not daily:
    st.info("No data recorded yet.")
    st.stop()

df = pd.DataFrame(daily)
df["date"] = pd.to_datetime(df["date"])
df = df.sort_values("date")

# ── Daily active users ───────────────────────────────────────────────────────
st.subheader("Daily Active Instances")
st.line_chart(df.set_index("date")[["unique_users", "total_users"]], use_container_width=True)

# ── Retention ────────────────────────────────────────────────────────────────
st.subheader("Retention Rates")
st.caption("Percentage of instances that were also active N days earlier.")

retention_df = pd.json_normalize(df["retention"].tolist())
retention_df.index = df["date"].values
retention_df.columns = ["D1", "D7", "D30", "D90", "D365"]
retention_df = retention_df * 100  # to percent

st.line_chart(retention_df.dropna(how="all"), use_container_width=True)

with st.expander("Retention table (last 30 days)"):
    display = retention_df.tail(30).copy()
    display.index = display.index.astype(str)
    st.dataframe(
        display.style.format("{:.1f}%", na_rep="—"),
        use_container_width=True,
    )

# ── Per-field aggregate stats ─────────────────────────────────────────────────
st.subheader("Usage Statistics")
st.caption("Aggregated from all active instances — medians shown to reduce skew.")

field_labels = {
    "nbr_files": "Files",
    "nbr_projects": "Projects",
    "nbr_tags": "Tags",
    "nbr_calendars": "Calendar records",
    "nbr_hours": "Hours tracked",
    "nbr_summaries": "Summaries",
    "nbr_links": "File links",
    "files_without_tag": "Files without tag",
    "files_without_project": "Files without project",
}

latest = df.iloc[-1]
if latest["fields"]:
    field_data = []
    for key, label in field_labels.items():
        stats = latest["fields"].get(key)
        if stats:
            field_data.append(
                {
                    "Metric": label,
                    "Median": stats.get("median"),
                    "Average": round(stats.get("avg", 0), 1),
                    "Total (sum)": stats.get("sum"),
                }
            )
    if field_data:
        st.dataframe(pd.DataFrame(field_data).set_index("Metric"), use_container_width=True)
    else:
        st.info("No field stats yet.")

st.divider()
st.caption(
    "Data is collected once per day per instance with explicit user consent. "
    "Source code for this telemetry system is included in the GodAssistant repository."
)

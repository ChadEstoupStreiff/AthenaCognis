import json
import os

import requests
import streamlit as st
from core import api_client
from core.files import representation_mode_select, display_files
from core.calendar import box_calendar_record
from core.calendar import search_engine as calendar_search_engine
from core.explorer import run_streaming_search, search_engine as file_search_engine
from utils import generate_badges_html, spacer, toast_for_rerun, get_setting


def _parse_files(files_json):
    """files is either a list of plain paths (legacy) or {"path", "source"} dicts (with provenance)."""
    raw = json.loads(files_json) if files_json else []
    return [f if isinstance(f, dict) else {"path": f, "source": "manual"} for f in raw]


@st.dialog("🆕 New Chat")
def dialog_new_chat():
    # MARK: New chat
    with st.form("new_chat_form"):
        chat_title = st.text_input(
            "Chat Title",
            placeholder="Enter chat title",
            help="Enter a title for the new chat session.",
        )

        if st.form_submit_button("Create Chat", use_container_width=True, type="primary"):
            response = api_client.post("/chat/create?title=" + chat_title)
            if response.status_code == 200:
                toast_for_rerun(
                    f"Chat '{chat_title}' created successfully!",
                    icon="🆕",
                )
                load_chat_session(response.json()["id"])
            else:
                st.error("Failed to create chat.")


@st.dialog("📁 Search files", width="large")
def dialog_search_files():
    # MARK: Search files
    with st.expander("Search Files", expanded=True):
        search_params = file_search_engine(nbr_columns=3, streaming=True)
        if search_params is not None:
            st.session_state.chat_search_files = run_streaming_search(search_params)["files"]

    top = st.container()

    if "chat_search_files" in st.session_state:
        representation_mode, show_preview, nbr_of_files_per_line = (
            representation_mode_select(
                default_mode=get_setting("chat_files_default_representation_mode")
            )
        )
        selected = display_files(
            st.session_state.chat_search_files,
            representation_mode=representation_mode,
            show_preview=show_preview,
            nbr_of_files_per_line=nbr_of_files_per_line,
            multi_select_mode=1,
            allow_actions=False,
            key="chat_search_files_selection",
        )
    else:
        selected = []

    with top:
        if st.button("Add Selected Files", disabled=not selected, use_container_width=True, type="primary"):
            for file in selected:
                if file not in st.session_state.chat_files:
                    st.session_state.chat_files.append(file)
            del st.session_state.chat_search_files
            toast_for_rerun(
                f"Added {len(selected)} files to the chat.",
                icon="✅",
            )
            st.rerun()


@st.dialog("📅 Search calendars", width="large")
def dialog_search_calendars():
    # MARK: Search calendars
    result = calendar_search_engine()
    if result:
        st.session_state.chat_search_calendars = result["records"]

    selected = []
    if "chat_search_calendars" in st.session_state:
        default_value = st.checkbox(
            "Select all calendar events",
            label_visibility="hidden",
            value=False,
            key="select_all_calendars",
        )
        spacer()

        for record in st.session_state.chat_search_calendars:
            cols = st.columns([1, 9])
            with cols[0]:
                if st.checkbox("", value=default_value, key=record.get("id")):
                    selected.append(record)
            with cols[1]:
                box_calendar_record(
                    record,
                    show_edit_button=False,
                )

        if st.button("Add Selected Calendar Events", use_container_width=True, type="primary"):
            if len(selected) > 0:
                for record in selected:
                    if record not in st.session_state.chat_calendars:
                        st.session_state.chat_calendars.append(record)
                del st.session_state.chat_search_calendars
                toast_for_rerun(
                    f"Added {len(selected)} calendar events to the chat.",
                    icon="✅",
                )
                st.rerun()
            else:
                st.warning("No calendar events selected.")


@st.dialog("✏️ Edit")
def dialog_edit_chat():
    # MARK: Edit chat
    if "chat_session" not in st.session_state:
        st.warning("No chat session selected.")
        return

    chat_info = st.session_state.chat_infos
    chat_title = st.text_input("Chat Title", value=chat_info["title"])
    chat_description = st.text_area("Chat Description", value=chat_info["description"])

    if st.button("✏️Save Changes", use_container_width=True, type="primary"):
        response = api_client.put(
            f"/chat/{st.session_state.chat_session}/edit?title={chat_title}&description={chat_description}",
        )
        if response.status_code == 200:
            toast_for_rerun("Chat updated successfully!", icon="✅")
            load_chat_session(st.session_state.chat_session)
        else:
            st.error(f"Failed to update chat. {response.text}")


@st.dialog("🗑️ Delete")
def dialog_delete_chat():
    # MARK: Delete chat
    st.warning(
        "Are you sure you want to delete this chat? This action cannot be undone."
    )
    if st.button(
        "🗑️ Delete Chat",
        use_container_width=True,
        key=f"delete_chat_{st.session_state.chat_session}",
    ):
        response = api_client.delete(f"/chat/{st.session_state.chat_session}")
        if response.status_code == 200:
            toast_for_rerun("Chat deleted successfully!", icon="🗑️")
            clear_chat()
            st.rerun()
        else:
            st.error(f"Failed to delete chat. {response.text}")


@st.dialog("💬 Message presets", width="large")
def dialog_message_presets():
    # MARK: Presets
    def save_presets(presets):
        response = requests.post("http://back:80/settings/chat_presets?value=" + json.dumps(presets))
        if response.status_code == 200:
            toast_for_rerun("Presets saved successfully!", icon="✅")
            st.rerun()
        else:
            st.error(f"Failed to save presets: {response.text}")

    cols = st.columns(4)
    with cols[0]:
        show_message = st.toggle(
            "Show message",
            value=False,
            key="show_message_presets",
        )
    with cols[1]:
        show_edition = st.toggle(
            "Show edition",
            value=False,
            key="show_edition_presets",
        )
    with cols[2]:
        show_deletion = st.toggle(
            "Show deletion",
            value=False,
            key="show_deletion_presets",
        )
    with cols[3]:
        show_addition = st.toggle(
            "Show addition",
            value=False,
            key="show_addition_presets",
        )

    res = requests.get("http://back:80/settings/chat_presets")
    if res.status_code != 200:
        st.error("Failed to load message presets.")
        return
    presets = res.json()

    if len(presets) == 0:
        st.info("No message presets available.")
    else:
        if show_addition:
            with st.form("create_preset"):
                st.subheader("➕ Add new preset")
                new_title = st.text_input("New title")
                new_message = st.text_area("New message")
                submitted = st.form_submit_button("Add preset", use_container_width=True)
                if submitted and new_title and new_message:
                    presets.append([new_title, new_message])
                    save_presets(presets)
                    toast_for_rerun("Preset added successfully!", icon="✅")
                    st.rerun()
            st.divider()

        top = st.container()
        n_cols = 2
        for i in range(len(presets) // n_cols + 1):
            cols = st.columns(n_cols)
            for j in range(n_cols):
                index = i * n_cols + j
                if index < len(presets):
                    preset = presets[index]
                    title, message = preset
                    with cols[j]:
                        with st.container(
                            border=show_message or show_edition or show_deletion
                        ):
                            if st.button(
                                title, use_container_width=True, key=f"preset_{index}"
                            ):
                                send_message(message)
                            if show_message:
                                st.markdown(f"💬 {message}")

                            if show_edition:
                                with st.expander("✏️", expanded=True):
                                    preset[0] = st.text_input(
                                        "Title", value=title, key=f"title_{index}"
                                    )
                                    preset[1] = st.text_area(
                                        "Message", value=message, key=f"msg_{index}"
                                    )

                            if show_deletion:
                                st.divider()
                                if st.button(
                                    "🗑️ Delete",
                                    key=f"delete_{index}",
                                    use_container_width=True,
                                ):
                                    presets.pop(index)
                                    save_presets(presets)
        if show_edition:
            with top:
                if st.button("✏️ Save edition", use_container_width=True, key="save_presets", type="primary"):
                    save_presets(presets)
                st.divider()

def clear_chat():
    # MARK: Clear
    for key in ["chat_session", "chat_infos", "chat_files", "chat_calendars", "chat_messages", "chat_failed_prompt"]:
        st.session_state.pop(key, None)


def load_chat_session(session_id, silent: bool = False):
    # MARK: Load
    st.session_state.chat_session = session_id
    st.session_state.chat_infos = api_client.get(f"/chat/{session_id}/info").json()
    st.session_state.chat_messages = api_client.get(
        f"/chat/{st.session_state.chat_session}/messages"
    ).json()

    if len(st.session_state.chat_messages) > 0:
        last_files = _parse_files(st.session_state.chat_messages[-1].get("files"))
        st.session_state.chat_files = [f["path"] for f in last_files if f.get("source") != "retrieved"]

        chat_calendars = st.session_state.chat_messages[-1].get("calendar", [])
        if not chat_calendars or len(chat_calendars) == 0:
            st.session_state.chat_calendars = []
        else:
            st.session_state.chat_calendars = json.loads(chat_calendars)
    else:
        st.session_state.chat_files = []
        st.session_state.chat_calendars = []

    if not silent:
        toast_for_rerun(
            f"Loaded chat session: {st.session_state.chat_infos['title']}",
            icon="✅",
        )
    st.rerun()


# MARK: Thinking
def is_chat_running(session_id):
    try:
        response = api_client.get(f"/chat/{session_id}/is_running")
        if response.status_code == 200:
            return response.json()
        else:
            st.toast("Failed to check chat status.", icon="❌")
            return False
    except requests.RequestException as e:
        st.toast(f"Error checking chat status: {e}", icon="❌")
        return False


@st.fragment(run_every=0.4)
def render_active_generation(session_id):
    run_state = is_chat_running(session_id)

    if not run_state or run_state.get("state") == "not_running":
        load_chat_session(session_id, silent=True)
        return

    with st.chat_message("assistant"):
        answer = run_state.get("answer", "")
        st.markdown(answer if answer else "_Thinking..._")
        if st.button("⏹ Stop generating", key=f"stop_gen_{session_id}"):
            try:
                api_client.post(f"/chat/{session_id}/cancel")
                st.toast("Cancellation requested.", icon="⏹")
            except requests.RequestException as e:
                st.toast(f"Failed to cancel: {e}", icon="❌")


def send_message(prompt):
    try:
        response = api_client.post(
            f"/chat/{st.session_state.chat_session}/message",
            json={
                "user_description": get_setting("chat_user_description", "") if st.session_state.chat_include_user_description else "",
                "content": prompt,
                "files": st.session_state.chat_files,
                "calendars": st.session_state.chat_calendars,
                "rag_enabled": st.session_state.get("chat_rag_enabled", True),
            },
        )
    except requests.RequestException as e:
        st.session_state.chat_failed_prompt = prompt
        st.toast(f"Failed to send message: {e}", icon="❌")
        return

    if response.status_code == 200:
        st.session_state.chat_messages.append(response.json())
        st.session_state.pop("chat_failed_prompt", None)
        st.rerun()
    elif response.status_code == 400:
        st.toast("This chat is already generating a response.", icon="⏳")
    else:
        st.session_state.chat_failed_prompt = prompt
        st.toast("Failed to send message.", icon="❌")


def chat():
    # MARK: Main
    with st.sidebar:
        with st.container(border=True):
            if st.button("🆕 New Chat", use_container_width=True, type="primary"):
                dialog_new_chat()

            try:
                chats = api_client.get("/chat/list").json()
            except requests.RequestException as e:
                st.error(f"Error fetching chat sessions: {e}")
                return

            selected_session = st.selectbox(
                "Select a session",
                chats,
                format_func=lambda chat: f"{chat['title']} ({chat['date'][:10]})",
                on_change=clear_chat,
            )

    if "chat_session" not in st.session_state and selected_session:
        load_chat_session(selected_session["id"])

    if "chat_session" in st.session_state:
        with st.sidebar:
            # MARK: Infos
            st.header(f"Chat: {st.session_state.chat_infos['title']}")
            st.markdown(f"**Created on:** {st.session_state.chat_infos['date']}")
            if st.session_state.chat_infos["description"]:
                st.subheader(st.session_state.chat_infos["description"])

            cols = st.columns(2)
            with cols[0]:
                if st.button("✏️ Edit Chat", use_container_width=True):
                    dialog_edit_chat()
            with cols[1]:
                if st.button("🗑️ Delete Chat", use_container_width=True):
                    dialog_delete_chat()

            st.divider()

            if st.button(
                "💬 Message presets", use_container_width=True, key="message_presets"
            ):
                dialog_message_presets()

            st.session_state.chat_include_user_description = st.toggle("Include user description", value=False, key="include_user_description")
            st.session_state.chat_rag_enabled = st.toggle(
                "🔍 Auto-retrieve notes",
                value=get_setting("chat_rag_enabled_default", True),
                key="chat_rag_toggle",
                help="Automatically pull in relevant notes/files from your library based on your message, without attaching them manually.",
            )

            st.markdown("**Files attached**")
            # MARK: Files
            cols = st.columns(2)
            with cols[0]:
                if st.button(
                    "📁 Search",
                    use_container_width=True,
                    key=f"search_files_{st.session_state.chat_session}",
                ):
                    if "chat_search_files" in st.session_state:
                        del st.session_state.chat_search_files
                    dialog_search_files()
            with cols[1]:
                if st.button(
                    "🗑️ Clear",
                    use_container_width=True,
                    key=f"clear_files_{st.session_state.chat_session}",
                ):
                    st.session_state.chat_files = []
                    toast_for_rerun("Cleared all files from the chat.", icon="🗑️")
                    st.rerun()

            if len(st.session_state.chat_files) == 0:
                st.markdown("No files attached to this chat.")
            else:
                st.markdown(
                    generate_badges_html(
                        [
                            "📎 " + os.path.basename(f)
                            for f in st.session_state.chat_files
                        ]
                    ),
                    unsafe_allow_html=True,
                )

            # MARK: Calendars
            spacer()
            st.markdown("**Calendar events attached**")
            cols = st.columns(2)
            with cols[0]:
                if st.button(
                    "📅 Search",
                    use_container_width=True,
                    key=f"search_calendar_{st.session_state.chat_session}",
                ):
                    if "chat_search_calendars" in st.session_state:
                        del st.session_state.chat_search_calendars
                    dialog_search_calendars()
            with cols[1]:
                if st.button(
                    "🗑️ Clear",
                    use_container_width=True,
                    key=f"clear_calendar_{st.session_state.chat_session}",
                ):
                    st.session_state.chat_calendars = []
                    toast_for_rerun("Cleared all calendars events to this chat.")
                    st.rerun()

            if len(st.session_state.chat_calendars) == 0:
                st.markdown("No calendar events attached to this chat.")
            else:
                st.markdown(
                    generate_badges_html(
                        [
                            f"📅 {c['date'].replace('T', ' ').replace('Z', '')} - {c['time_spent']}h - {c['title']}"
                            for c in st.session_state.chat_calendars
                        ],
                        color="rgb(155, 89, 182)",
                        bg_color="rgba(155, 89, 182, 0.2)",
                    ),
                    unsafe_allow_html=True,
                )

        # MARK: Chat
        for msg_idx, message in enumerate(st.session_state.chat_messages):
            user = message["user"]
            date = message["date"].replace("T", " ").replace("Z", "")
            content = message["content"]
            files = _parse_files(message["files"])
            manual_files = [f["path"] for f in files if f.get("source") != "retrieved"]
            retrieved_files = [f["path"] for f in files if f.get("source") == "retrieved"]
            calendars = json.loads(message["calendar"]) if message["calendar"] else []
            is_system = user in ("system-error", "system-cancelled")

            with st.chat_message("assistant" if user != "user" else "user"):
                if is_system:
                    icon = "⚠️" if user == "system-error" else "⏹️"
                    st.warning(f"{icon} {content}")
                    continue

                if user != "user":
                    caption_cols = st.columns([10, 1])
                    caption_cols[0].caption(f"**{user}** - {date}")
                    with caption_cols[1]:
                        with st.popover("📋", help="Copy response"):
                            st.code(content, language=None)
                    if len(retrieved_files) > 0:
                        st.markdown(
                            generate_badges_html(
                                ["🔎 " + os.path.basename(f) for f in retrieved_files],
                                color="rgb(52, 152, 219)",
                                bg_color="rgba(52, 152, 219, 0.2)",
                            ),
                            unsafe_allow_html=True,
                        )
                        spacer(15)
                else:
                    st.caption(f"**You** - {date}")
                    if len(manual_files) > 0:
                        st.markdown(
                            generate_badges_html(
                                ["📎 " + os.path.basename(f) for f in manual_files]
                            ),
                            unsafe_allow_html=True,
                        )
                    if len(calendars) > 0:
                        st.markdown(
                            generate_badges_html(
                                [
                                    f"📅 {c['date'].replace('T', ' ').replace('Z', '')} - {c['time_spent']}h - {c['title']}"
                                    for c in calendars
                                ],
                                color="rgb(255, 200, 255)",
                                bg_color="rgba(155, 89, 182, 0.3)",
                            ),
                            unsafe_allow_html=True,
                        )
                    if len(manual_files) > 0 or len(calendars) > 0:
                        spacer(15)
                st.markdown(content)

        chat_run_state = is_chat_running(st.session_state.chat_session)
        if chat_run_state and chat_run_state.get("state") != "not_running":
            render_active_generation(st.session_state.chat_session)

        if st.session_state.get("chat_failed_prompt"):
            st.warning(f"⚠️ Failed to send: \"{st.session_state.chat_failed_prompt}\"")
            if st.button("🔁 Retry", key="retry_failed_prompt"):
                failed_prompt = st.session_state.chat_failed_prompt
                send_message(failed_prompt)

        prompt = st.chat_input(
            "Ask a question.",
        )
        if prompt:
            send_message(prompt)


if __name__ == "__main__":
    chat()

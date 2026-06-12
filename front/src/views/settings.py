import copy
import datetime

import pandas as pd
import requests
import streamlit as st
from utils import (
    generate_tag_visual_markdown,
    refractor_text_area,
    spacer,
    toast_for_rerun,
)


# MARK: Settings func
def load_settings():
    return requests.get("http://back:80/settings").json()


def apply_settings(settings):
    """
    Apply the settings selected by the user.
    This function is a placeholder for applying settings.
    """
    result = requests.post(
        "http://back:80/settings",
        json=settings,
    )
    if result.status_code == 200:
        # st.toast("Settings applied successfully!", icon="✅")
        toast_for_rerun("Settings applied successfully!", icon="✅")
        st.rerun()
    else:
        st.toast(
            "Failed to apply settings. Please try again later.",
            icon="❌",
        )


def ai_settings(prefix: str):
    pass


# MARK: Project func
@st.dialog("🆕 Create Project")
def dialog_create_project():
    """
    Dialog for creating a new project.
    """
    name = st.text_input(
        "Project Name", help="Enter the name of the project.", max_chars=50
    )
    description = refractor_text_area(
        "Project Description",
        help="Enter a brief description of the project.",
    )
    color = st.color_picker(
        "Project Color",
        value="#0000FF",  # Default to blue
        help="Select a color for the project.",
    )
    st.write(color)

    if st.button("Create Project", use_container_width=True):
        response = requests.post(
            f"http://back:80/project?name={name}&description={description}&color={color[1:]}"
        )
        if response.status_code == 200:
            toast_for_rerun("Project created successfully!", icon="✅")
            st.rerun()
        else:
            st.error("Failed to create project. Please try again.")
            st.toast("Failed to create project. Please try again.", icon="❌")


@st.dialog("✏️ Edit Project")
def dialog_edit_project(project):
    """
    Dialog for editing an existing project.
    """
    name = st.text_input(
        "Project Name",
        value=project["name"],
        help="Enter the name of the project.",
        max_chars=50,
    )
    description = refractor_text_area(
        "Project Description",
        value=project["description"] or "",
        help="Enter a brief description of the project.",
    )
    color = st.color_picker(
        "Project Color",
        value=project["color"],
        help="Select a color for the project.",
    )

    if st.button("Update Project", use_container_width=True):
        response = requests.put(
            f"http://back:80/project/{project['name']}?name={name}&description={description}&color={color[1:]}",
        )
        if response.status_code == 200:
            toast_for_rerun("Project updated successfully!", icon="✅")
            st.rerun()
        else:
            st.error("Failed to update project. Please try again.")


@st.dialog("🗑️ Delete project")
def dialog_delete_project(project):
    st.markdown(
        f"### Deleting  <span style='color:{project['color']};'>{project['name']}</span>",
        unsafe_allow_html=True,
    )
    st.warning(
        "Beware this action is irreversible and will impact other module of the app such as calendar or explorer! Are you sure you want to delete this project?"
    )
    if st.button("Delete 🗑️", use_container_width=True):
        response = requests.delete(f"http://back:80/project/{project['name']}")
        if response.status_code == 200:
            toast_for_rerun("Project deleted successfully!", icon="🗑️")
            st.rerun()
        else:
            st.error("Failed to delete project. Please try again.")


# MARK: Tag func


@st.dialog("🆕 Create Tag")
def dialog_create_tag():
    """
    Dialog for creating a new tag.
    """
    with st.form("create_tag_form"):
        name = st.text_input(
            "Tag Name",
            help="Enter the name of the tag.",
            max_chars=20,
        )
        color = st.color_picker(
            "Tag Color",
            value="#FF0000",  # Default to red
            help="Select a color for the tag.",
        )

        if st.form_submit_button("Create Tag", use_container_width=True):
            response = requests.post(
                f"http://back:80/tag?name={name}&color={color[1:]}"
            )
            if response.status_code == 200:
                toast_for_rerun("Tag created successfully!", icon="✅")
                st.rerun()
            else:
                st.error("Failed to create tag. Please try again.")


@st.dialog("✏️ Edit Tag")
def dialog_edit_tag(tag):
    """
    Dialog for editing an existing tag.
    """
    with st.form("edit_tag_form"):
        name = st.text_input(
            "Tag Name",
            value=tag["name"],
            help="Enter the name of the tag.",
            max_chars=20,
        )
        color = st.color_picker(
            "Tag Color",
            value=tag["color"],
            help="Select a color for the tag.",
        )

        if st.form_submit_button("Update Tag", use_container_width=True):
            response = requests.put(
                f"http://back:80/tag/{tag['name']}?name={name}&color={color[1:]}"
            )
            if response.status_code == 200:
                toast_for_rerun("Tag updated successfully!", icon="✅")
                st.rerun()
            else:
                st.error("Failed to update tag. Please try again.")


@st.dialog("🗑️ Delete Tag")
def dialog_delete_tag(tag):
    st.markdown(
        f"### Deleting  <span style='color:{tag['color']};'>{tag['name']}</span>",
        unsafe_allow_html=True,
    )
    st.warning(
        "Beware this action is irreversible and will impact other module of the app such as calendar or explorer! Are you sure you want to delete this tag?"
    )
    if st.button("Delete 🗑️", use_container_width=True):
        response = requests.delete(f"http://back:80/tag/{tag['name']}")
        if response.status_code == 200:
            toast_for_rerun("Tag deleted successfully!", icon="🗑️")
            st.rerun()
        else:
            st.error("Failed to delete tag. Please try again.")


# MARK: Tasks func


def fetch_display_tasks(task_type: str, file: str = None):
    """
    Load tasks from the backend based on the task type and optional file.
    """
    result_health = requests.get(f"http://back:80/{task_type}/health")
    if result_health.status_code != 200:
        st.error(f"Failed to fetch {task_type} health status: {result_health.text}")
    else:
        health_status = result_health.json()
        result_running = requests.get(f"http://back:80/{task_type}/running")
        if result_running.status_code == 200 and result_running.json() is not None:
            st.caption(
                f"Daemon health: {health_status} - {result_running.content.decode('utf-8')}"
            )
        else:
            st.caption(f"Daemon health: {health_status}")

    result_tasks = requests.get(
        f"http://back:80/{task_type}/tasks" + (f"/{file}" if file else "")
    )
    if result_tasks.status_code == 200:
        tasks = result_tasks.json()
        if tasks:
            tasks_df = pd.DataFrame(tasks)
            st.dataframe(
                tasks_df, use_container_width=True, hide_index=True, height=300
            )
        else:
            st.warning(f"No {task_type} tasks available.")
    else:
        st.error(f"Failed to fetch {task_type} tasks: {result_tasks.text}")


def tasks(
    file=None,
    list_ocr: bool = True,
    list_transcription: bool = True,
):
    with st.expander("Summarization Tasks", expanded=True):
        fetch_display_tasks("summarize", file)

    if list_ocr:
        with st.expander("OCR & BLIP Tasks", expanded=True):
            fetch_display_tasks("ocr", file)

    if list_transcription:
        with st.expander("Transcription Tasks", expanded=True):
            fetch_display_tasks("transcription", file)

    with st.expander("Preview Tasks", expanded=True):
        fetch_display_tasks("preview", file)


def chose_ai_menu(default_ai_type: str, default_model: str, key: str = "ai_menu"):
    import requests
    import streamlit as st

    ai_type_options = ["llama", "Mistral", "ChatGPT", "Gemini"]
    ai_type = st.radio(
        "AI type",
        ai_type_options,
        index=ai_type_options.index(default_ai_type),
        horizontal=True,
        key=f"{key}_type",
        help="Select the AI type to use for this setting.",
    )

    model = default_model
    if ai_type == "llama":
        result = requests.get("http://back:80/ollama/list")
        installed_models = (
            [m["name"] for m in result.json()] if result.status_code == 200 else []
        )
        if not installed_models:
            st.error("Failed to fetch installed LLaMA models.")
        model = st.selectbox(
            "LLaMA Model",
            options=installed_models,
            index=installed_models.index(default_model)
            if default_model in installed_models
            else 0,
            key=f"{key}_model",
            help="Select the LLaMA model to use.",
        )
    elif ai_type == "Mistral":
        mistral_models = [
            "ministral-3b-latest",
            "ministral-8b-latest",
            "mistral-small-latest",
            "mistral-medium-latest",
            "mistral-large-latest",
            "magistral-small-latest",
            "magistral-medium-latest",
        ]
        model = st.selectbox(
            "Mistral Model",
            options=mistral_models,
            index=mistral_models.index(default_model)
            if default_model in mistral_models
            else 0,
            key=f"{key}_model",
            help="Select the Mistral model to use.",
        )
    elif ai_type == "ChatGPT":
        chatgpt_models = [
            "gpt-4.1-nano",
            "gpt-4.1-mini",
            "gpt-4o-mini",
            "gpt-3.5-turbo",
            "gpt-4.1",
            "gpt-4o",
            "gpt-4",
        ]
        model = st.selectbox(
            "ChatGPT Model",
            options=chatgpt_models,
            index=chatgpt_models.index(default_model)
            if default_model in chatgpt_models
            else 0,
            key=f"{key}_model",
            help="Select the OpenAI ChatGPT model to use.",
        )

    elif ai_type == "Gemini":
        gemini_models = [
            "gemini-2.0-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
        ]
        model = st.selectbox(
            "Gemini Model",
            options=gemini_models,
            index=gemini_models.index(default_model)
            if default_model in gemini_models
            else 0,
            key=f"{key}_model",
            help="Select the Google Gemini model to use.",
        )
    return ai_type, model


def chose_vision_ai_menu(default_type: str, default_model: str, key: str, local_label: str = "Local", local_key: str = "local"):
    import requests
    import streamlit as st

    type_options = [local_key, "llama", "Mistral", "ChatGPT", "Gemini"]
    type_labels = [local_label, "Local Llama (Ollama)", "Mistral", "ChatGPT", "Gemini"]
    resolved_default = default_type if default_type in type_options else local_key
    ai_type = st.radio(
        "Provider",
        type_options,
        format_func=lambda x: type_labels[type_options.index(x)],
        index=type_options.index(resolved_default),
        horizontal=True,
        key=f"{key}_type",
    )

    model = default_model
    if ai_type == local_key:
        st.caption(f"Using the built-in {local_label} engine.")
    elif ai_type == "llama":
        result = requests.get("http://back:80/ollama/list")
        installed_models = (
            [m["name"] for m in result.json()] if result.status_code == 200 else []
        )
        vision_models = [m for m in installed_models if any(
            tag in m for tag in ["llava", "moondream", "bakllava", "minicpm", "vision"]
        )] or installed_models
        if not vision_models:
            st.error("No vision-capable LLaMA models found. Pull a vision model (e.g. llava:7b).")
        model = st.selectbox(
            "LLaMA Vision Model",
            options=vision_models,
            index=vision_models.index(default_model) if default_model in vision_models else 0,
            key=f"{key}_model",
            help="Select a vision-capable Ollama model (e.g. llava:7b).",
        )
    elif ai_type == "Mistral":
        pixtral_models = ["pixtral-12b-2409", "pixtral-large-2411"]
        model = st.selectbox(
            "Mistral Vision Model",
            options=pixtral_models,
            index=pixtral_models.index(default_model) if default_model in pixtral_models else 0,
            key=f"{key}_model",
        )
    elif ai_type == "ChatGPT":
        gpt_vision_models = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4.1"]
        model = st.selectbox(
            "OpenAI Vision Model",
            options=gpt_vision_models,
            index=gpt_vision_models.index(default_model) if default_model in gpt_vision_models else 0,
            key=f"{key}_model",
        )
    elif ai_type == "Gemini":
        gemini_vision_models = [
            "gemini-2.0-flash",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
        ]
        model = st.selectbox(
            "Gemini Vision Model",
            options=gemini_vision_models,
            index=gemini_vision_models.index(default_model) if default_model in gemini_vision_models else 0,
            key=f"{key}_model",
        )
    return ai_type, model


def chose_transcription_menu(default_type: str, default_model: str, key: str):
    import streamlit as st

    type_options = ["local", "openai", "groq"]
    type_labels = ["Local (faster-whisper)", "OpenAI Whisper API", "Groq Whisper API"]
    transcription_type = st.radio(
        "Provider",
        type_options,
        format_func=lambda x: type_labels[type_options.index(x)],
        index=type_options.index(default_type) if default_type in type_options else 0,
        horizontal=True,
        key=f"{key}_type",
    )

    model = default_model
    if transcription_type == "local":
        local_models = ["tiny", "base", "small", "medium", "large-v3"]
        model = st.radio(
            "Whisper model",
            options=local_models,
            index=local_models.index(default_model) if default_model in local_models else 2,
            horizontal=True,
            key=f"{key}_model",
        )
        st.markdown("""
| Model    | Speed   | RAM     | WER (English) |
|----------|---------|---------|---------------|
| tiny     | Fastest | ~1–2 GB | ~14–15%       |
| base     | Fast    | ~2–3 GB | ~10–11%       |
| small    | Fast    | ~4–5 GB | ~6–7%         |
| medium   | Slower  | ~7–8 GB | ~4–5%         |
| large-v3 | Slowest | ~10–12 GB | ~2.7%       |
""")
    elif transcription_type == "openai":
        st.caption("Uses OpenAI's Whisper API. Requires an OpenAI API key in LLM Settings.")
        model = "whisper-1"
        st.info("Model: whisper-1 (only available model on OpenAI Whisper API)")
    elif transcription_type == "groq":
        st.caption("Uses Groq's ultra-fast Whisper API. Requires a Groq API key in LLM Settings.")
        groq_models = ["whisper-large-v3", "whisper-large-v3-turbo"]
        model = st.selectbox(
            "Groq Whisper Model",
            options=groq_models,
            index=groq_models.index(default_model) if default_model in groq_models else 0,
            key=f"{key}_model",
        )
    return transcription_type, model


def settings():
    """
    Settings page for the application.
    This function is a placeholder for the settings view.
    """
    settings_tabs = st.tabs(
        [
            "Application Settings",
            "Projects Management",
            "Tags Management",
            "LLM Settings",
            "Tasks",
        ]
    )

    result = requests.get("http://back:80/ollama/list")
    if result.status_code == 200:
        installed_models = [m["name"] for m in result.json()]
    else:
        installed_models = None

        if installed_models is None:
            st.error("Failed to fetch installed models. Please try again later.")

    with settings_tabs[0]:
        # MARK: Application Settings
        loaded_settings = load_settings()
        settings = copy.deepcopy(loaded_settings)

        cols = st.columns(6)
        with cols[0]:
            settings["auto_display_file_size_limit"] = st.number_input(
                "Auto display file size limit (MB), -1 to disable",
                min_value=-1,
                value=settings.get("auto_display_file_size_limit", 10),
                help="Set the maximum file size (in MB) for automatic display in the viewer.",
            )

        with cols[1]:
            settings["search_default_timeframe_days"] = st.number_input(
                "Default search timeframe (days)",
                min_value=1,
                value=settings.get("search_default_timeframe_days", 30),
                help="Set the default timeframe (in days) for search operations.",
            )
        
        with cols[2]:
            settings["target_hourly_working_time"] = st.number_input(
                "Target hourly working time (hours)",
                min_value=0.0,
                value=settings.get("target_hourly_working_time", 7.5),
                help="Set the target hourly working time (in hours) for productivity tracking. +-1 hour tolerance.",
            )

        representation_options = ["🧮 Table", "🃏 Cards", "🏷️ List"]
        with cols[3]:
            settings["explorer_default_representation_mode"] = st.segmented_control(
                "Default representation mode in EXPLORER",
                options=range(len(representation_options)),
                format_func=lambda x: representation_options[x],
                default=settings.get("explorer_default_representation_mode", 1),
                key="representation",
            )
        with cols[4]:
            settings["projects_default_representation_mode"] = st.segmented_control(
                "Default representation mode in PROJECTS",
                options=range(len(representation_options)),
                format_func=lambda x: representation_options[x],
                default=settings.get("projects_default_representation_mode", 1),
                key="projects_representation",
            )
        with cols[5]:
            settings["chat_files_default_representation_mode"] = st.segmented_control(
                "Default representation mode in CHAT",
                options=range(len(representation_options)),
                format_func=lambda x: representation_options[x],
                default=settings.get("chat_files_default_representation_mode", 0),
                key="chat_representation",
            )

        with st.expander("Preview Settings", expanded=True):
            prev_cols = st.columns(4)
            with prev_cols[0]:
                settings["enable_auto_preview"] = st.toggle(
                    "Auto-generate previews on upload",
                    value=settings.get("enable_auto_preview", True),
                )
            with prev_cols[1]:
                quality_options = ["low", "medium", "high"]
                quality_labels = ["Low (144p)", "Medium (360p)", "High (720p)"]
                current_quality = settings.get("preview_quality", "medium")
                settings["preview_quality"] = st.radio(
                    "Preview quality",
                    options=quality_options,
                    format_func=lambda x: quality_labels[quality_options.index(x)],
                    index=quality_options.index(current_quality) if current_quality in quality_options else 1,
                    horizontal=True,
                    help="Resolution of image/PDF thumbnails.",
                )
            with prev_cols[2]:
                settings["preview_text_chars"] = st.number_input(
                    "Text preview characters",
                    min_value=50,
                    max_value=5000,
                    value=int(settings.get("preview_text_chars", 300)),
                    step=50,
                    help="Number of characters to show for text file previews.",
                )
            with prev_cols[3]:
                settings["preview_zip_subfiles"] = st.number_input(
                    "Archive preview entries",
                    min_value=1,
                    max_value=100,
                    value=int(settings.get("preview_zip_subfiles", 15)),
                    step=1,
                    help="Number of archive entries to list in zip/tar previews.",
                )

        cols = st.columns(2)
        with cols[0]:
            with st.expander("Calendar Progress Bar", expanded=True):
                settings["calendar_progress_bar_enabled"] = st.toggle(
                    "Show progress bar in Calendar",
                    value=settings.get("calendar_progress_bar_enabled", True),
                )
                settings["calendar_progress_bar_title"] = st.text_input(
                    "Bar title",
                    value=settings.get("calendar_progress_bar_title", "PhD Progress"),
                )
                pb_cols = st.columns(4)
                with pb_cols[0]:
                    pb_start_val = datetime.date.fromisoformat(
                        settings.get("calendar_progress_bar_start_date", "2025-11-01")
                    )
                    pb_start = st.date_input("Start date", value=pb_start_val, key="pb_start")
                    settings["calendar_progress_bar_start_date"] = pb_start.isoformat()
                with pb_cols[1]:
                    pb_end_val = datetime.date.fromisoformat(
                        settings.get("calendar_progress_bar_end_date", "2028-10-31")
                    )
                    pb_end = st.date_input("Due date", value=pb_end_val, key="pb_end")
                    settings["calendar_progress_bar_end_date"] = pb_end.isoformat()
                with pb_cols[2]:
                    settings["calendar_progress_bar_color1"] = st.color_picker(
                        "Color 1 (start/end)",
                        value=settings.get("calendar_progress_bar_color1", "#667eea"),
                    )
                with pb_cols[3]:
                    settings["calendar_progress_bar_color2"] = st.color_picker(
                        "Color 2 (middle peak)",
                        value=settings.get("calendar_progress_bar_color2", "#f093fb"),
                    )

            with st.expander("Chat Settings", expanded=True):
                settings["chat_type"], settings["chat_model"] = chose_ai_menu(
                    settings["chat_type"], settings["chat_model"], key="chat"
                )
                settings["chat_user_description"] = st.text_area(
                    "User Description",
                    value=settings["chat_user_description"],
                    help="Enter a description of the user for the chat model.",
                )
                st.caption(
                    "Note: The user description is used to provide context to the chat model."
                )
            with st.expander("Refractor Settings", expanded=True):
                settings["refractor_type"], settings["refractor_model"] = chose_ai_menu(
                    settings["refractor_type"],
                    settings["refractor_model"],
                    key="refractor",
                )

            with st.expander("Auto Link Settings", expanded=True):
                st.caption(
                    "AI model used by the 'Add auto link' feature to find semantic links between files."
                )
                settings["link_type"], settings["link_model"] = chose_ai_menu(
                    settings.get("link_type", "llama"),
                    settings.get("link_model", "llama3.2:1b"),
                    key="link",
                )

        with cols[1]:
            with st.expander("Summarization Settings", expanded=True):
                settings["enable_auto_summary"] = st.toggle(
                    "Enable auto Summarization",
                    value=settings["enable_auto_summary"],
                    help="Enable automatic summarization of text files when uploaded.",
                )
                settings["summarization_type"], settings["summarization_model"] = (
                    chose_ai_menu(
                        settings["summarization_type"],
                        settings["summarization_model"],
                        key="summarization",
                    )
                )

            with st.expander("OCR & BLIP Settings", expanded=True):
                st.caption(
                    "Note: The OCR & BLIP feature is only available for image files (e.g., png, jpg, jpeg, bmp, webp)."
                )
                settings["enable_auto_ocr"] = st.toggle(
                    "Enable auto OCR & BLIP Processing",
                    value=settings["enable_auto_ocr"],
                    help="Enable automatic OCR & BLIP processing of image files when uploaded.",
                )
                st.markdown("**Image Caption (BLIP)**")
                settings["blip_type"], settings["blip_model"] = chose_vision_ai_menu(
                    settings.get("blip_type", "local"),
                    settings.get("blip_model", "llava:7b"),
                    key="blip",
                    local_label="Local BLIP",
                )
                st.markdown("**Text Extraction (OCR)**")
                settings["ocr_type"], settings["ocr_model"] = chose_vision_ai_menu(
                    settings.get("ocr_type", "paddle"),
                    settings.get("ocr_model", "llava:7b"),
                    key="ocr",
                    local_label="Local PaddleOCR",
                    local_key="paddle",
                )

            with st.expander("Transcription Settings", expanded=True):
                st.caption(
                    "Note: The transcription feature is only available for audio files (e.g., mp3, wav, mp4, mov, avi)."
                )
                settings["enable_auto_transcription"] = st.toggle(
                    "Enable auto Transcription",
                    value=settings["enable_auto_transcription"],
                    help="Enable automatic transcription of audio files when uploaded.",
                )
                settings["transcription_type"], settings["transcription_model"] = chose_transcription_menu(
                    settings.get("transcription_type", "local"),
                    settings.get("transcription_model", "small"),
                    key="transcription",
                )

        if settings != loaded_settings:
            apply_settings(settings)

    # MARK: Projects Management
    with settings_tabs[1]:
        if st.button("🆕 Create new project", use_container_width=True):
            dialog_create_project()

        projects = requests.get("http://back:80/projects").json()
        if len(projects) == 0:
            st.warning(
                "No projects available. Please create a new project. Default ones will be created at next app restart."
            )
        for project in projects:
            with st.container(border=True, key=f"project_{project['name']}"):
                cols = st.columns([5, 1])
                with cols[0]:
                    st.markdown(
                        f"### <span style='color:{project['color']};'>{project['name']}</span>",
                        unsafe_allow_html=True,
                    )
                    st.caption(project["description"] or "No description provided.")
                with cols[1]:
                    if st.button(
                        "✏️",
                        key=f"edit_project_{project['name']}",
                        use_container_width=True,
                        help="✏️ Edit",
                    ):
                        dialog_edit_project(project)
                    if st.button(
                        "🗑️",
                        key=f"delete_project_{project['name']}",
                        use_container_width=True,
                        help="🗑️ Delete",
                    ):
                        dialog_delete_project(project)

    # MARK: Tags Management
    with settings_tabs[2]:
        if st.button("🆕 Create new tag", use_container_width=True):
            dialog_create_tag()

        tags = requests.get("http://back:80/tags").json()
        if len(tags) == 0:
            st.warning(
                "No tags available. Please create a new tag. Default ones will be created at next app restart."
            )
        for tag in tags:
            with st.container(border=True, key=f"tag_{tag['name']}"):
                cols = st.columns([5, 1])
                with cols[0]:
                    st.markdown(
                        generate_tag_visual_markdown(tag["name"], tag["color"]),
                        unsafe_allow_html=True,
                    )
                with cols[1]:
                    if st.button(
                        "✏️",
                        key=f"edit_tag_{tag['name']}",
                        use_container_width=True,
                        help="✏️ Edit",
                    ):
                        dialog_edit_tag(tag)
                    if st.button(
                        "🗑️",
                        key=f"delete_tag_{tag['name']}",
                        use_container_width=True,
                        help="🗑️ Delete",
                    ):
                        dialog_delete_tag(tag)

    # MARK: Tasks
    with settings_tabs[4]:
        tasks(
            file=None,
            list_ocr=True,
            list_transcription=True,
        )

    # MARK: LLM Settings
    with settings_tabs[3]:
        tab_llama, tab_mistral, tab_chatgpt, tab_gemini, tab_groq = st.tabs(
            ["Local Llama", "Mistral", "OpenAI ChatGPT", "Google Gemini", "Groq"]
        )

        spacer()
        st.divider()
        sort_type = st.radio(
            "Sort models by",
            options=["Type", "Capabilities", "Pricing"],
            index=0,
            horizontal=True,
            help="Choose how to sort the models in the list.",
        )
        if sort_type == "Type":
            st.markdown("""| Model                 | Type      | Capabilities                                                                 | Input/Output **\$ per 1M tokens** |
|-----------------------|-----------|------------------------------------------------------------------------------|----------------------------------|
| llama3.2:1b             | LLaMA     | Tiny model for simple tasks on constrained devices                          | **Free**                         |
| llama3.2:8b             | LLaMA     | Balanced open model for standard use cases                                  | **Free**                         |
| llama3.2:70b            | LLaMA     | High-quality open-source model with good reasoning                          | **Free**                         |
| ministral-3b-latest      | Mistral   | Most efficient edge model, 128k token context                      | **\$0.04 / \$0.04**                |
| ministral-8b-latest      | Mistral   | Powerful model for on-device use cases, 128k token context         | **\$0.10 / \$1.00**                |
| mistral-small-latest     | Mistral   | Multilingual and multimodal Apache 2.0 model, 32k token context   | **\$0.10 / \$0.30**                |
| mistral-medium-latest    | Mistral   | Cost-efficient enterprise-level performance, 128k token context     | **\$0.40 / \$2.00**                |
| mistral-large-latest     | Mistral   | Solves complex tasks with high quality, 128k token context         | **\$2.00 / \$6.00**                |
| magistral-small-latest   | Mistral   | Multilingual reasoning model, 40k token context                   | **\$0.50 / \$1.50**                |
| magistral-medium-latest  | Mistral   | High-end multilingual reasoning, 128k token context                | **\$2.00 / \$5.00**                |
| gemini-2.0-flash-lite | Gemini    | Smallest Gemini 2.0 for scalable usage with low latency                      | **\$0.075 / \$0.30**             |
| gemini-2.0-flash      | Gemini    | Balanced multimodal support (text/image/video/audio)                        | **\$0.10 / \$0.40**              |
| gemini-2.5-flash-lite | Gemini    | Lightweight 2.5 model, tuned for efficiency                                 | **\$0.10 / \$0.40**              |
| gemini-2.5-flash      | Gemini    | Hybrid reasoning model for speed and broad media support                    | **\$0.30 / \$2.50**              |
| gemini-2.5-pro        | Gemini    | Premium model for advanced reasoning, coding, and analysis                  | **\$1.25–2.50 / \$10.00–15.00**  |
| gpt-4.1-nano          | ChatGPT   | Ultra-light model for micro-tasks                                           | **\$0.10 / \$0.40**              |
| gpt-4.1-mini          | ChatGPT   | Efficient model with faster latency and reduced cost                        | **\$0.40 / \$1.60**              |
| gpt-4o-mini           | ChatGPT   | Fast and affordable multimodal model                                        | **\$0.15 / \$0.60**              |
| gpt-3.5-turbo         | ChatGPT   | Fast, general-purpose model for basic conversation and summarization        | **\$1.00 / \$2.00**              |
| gpt-4.1               | ChatGPT   | Stronger reasoning, faster than GPT-4, versatile                            | **\$2.00 / \$8.00**              |
| gpt-4o                | ChatGPT   | Top-tier multimodal model (text, image, audio), fast with high accuracy     | **\$2.50 / \$10.00**             |
| gpt-4                | ChatGPT   | High-quality reasoning and understanding, best for difficult tasks          | **\$30.00 / \$60.00**            |""")

        elif sort_type == "Capabilities":
            st.markdown("""| Model                 | Type      | Capabilities                                                                 | Input/Output **\$ per 1M tokens** |
|-----------------------|-----------|------------------------------------------------------------------------------|----------------------------------|
| gemini-2.5-flash      | Gemini    | Hybrid reasoning model for speed and broad media support                    | **\$0.30 / \$2.50**              |
| gpt-4.1-nano          | ChatGPT   | Ultra-light model for micro-tasks                                           | **\$0.10 / \$0.40**              |
| llama3.2:1b           | LLaMA     | Tiny model for simple tasks on constrained devices                          | **Free**                         |
| gemini-2.0-flash-lite | Gemini    | Smallest Gemini 2.0 for scalable usage with low latency                      | **\$0.075 / \$0.30**             |
| gemini-2.5-flash-lite | Gemini    | Lightweight 2.5 model, tuned for efficiency                                 | **\$0.10 / \$0.40**              |
| gpt-4.1-mini          | ChatGPT   | Efficient model with faster latency and reduced cost                        | **\$0.40 / \$1.60**              |
| gpt-4o-mini           | ChatGPT   | Fast and affordable multimodal model                                        | **\$0.15 / \$0.60**              |
| ministral-8b-latest   | Mistral   | Powerful model for on-device use cases, 128k token context                  | **\$0.10 / \$1.00**              |
| gemini-2.0-flash      | Gemini    | Balanced multimodal support (text/image/video/audio)                        | **\$0.10 / \$0.40**              |
| llama3.2:8b           | LLaMA     | Balanced open model for standard use cases                                  | **Free**                         |
| gpt-3.5-turbo         | ChatGPT   | Fast, general-purpose model for basic conversation and summarization        | **\$1.00 / \$2.00**              |
| gpt-4                | ChatGPT   | High-quality reasoning and understanding, best for difficult tasks          | **\$30.00 / \$60.00**            |
| llama3.2:70b          | LLaMA     | High-quality open-source model with good reasoning                          | **Free**                         |
| magistral-medium-latest  | Mistral   | High-end multilingual reasoning, 128k token context                         | **\$2.00 / \$5.00**              |
| gpt-4.1               | ChatGPT   | Stronger reasoning, faster than GPT-4, versatile                            | **\$2.00 / \$8.00**              |
| gemini-2.5-pro        | Gemini    | Premium model for advanced reasoning, coding, and analysis                  | **\$1.25–2.50 / \$10.00–15.00**  |
| magistral-small-latest | Mistral   | Multilingual reasoning model, 40k token context                             | **\$0.50 / \$1.50**              |
| mistral-small-latest  | Mistral   | Multilingual and multimodal Apache 2.0 model, 32k token context             | **\$0.10 / \$0.30**              |
| mistral-large-latest  | Mistral   | Solves complex tasks with high quality, 128k token context                  | **\$2.00 / \$6.00**              |
| mistral-medium-latest | Mistral   | Cost-efficient enterprise-level performance, 128k token context             | **\$0.40 / \$2.00**              |
| ministral-3b-latest   | Mistral   | Most efficient edge model, 128k token context                               | **\$0.04 / \$0.04**              |
| gpt-4o                | ChatGPT   | Top-tier multimodal model (text, image, audio), fast with high accuracy     | **\$2.50 / \$10.00**             |""")

        elif sort_type == "Pricing":
            st.markdown("""| Model                 | Type      | Capabilities                                                                 | Input/Output **\$ per 1M tokens** |
|-----------------------|-----------|------------------------------------------------------------------------------|----------------------------------|
| llama3.2:1b           | LLaMA     | Tiny model for simple tasks on constrained devices                          | **Free**                         |
| llama3.2:8b           | LLaMA     | Balanced open model for standard use cases                                  | **Free**                         |
| llama3.2:70b          | LLaMA     | High-quality open-source model with good reasoning                          | **Free**                         |
| ministral-3b-latest   | Mistral   | Most efficient edge model, 128k token context                               | **\$0.04 / \$0.04**              |
| gemini-2.0-flash-lite | Gemini    | Smallest Gemini 2.0 for scalable usage with low latency                      | **\$0.075 / \$0.30**             |
| gemini-2.0-flash      | Gemini    | Balanced multimodal support (text/image/video/audio)                        | **\$0.10 / \$0.40**              |
| gemini-2.5-flash-lite | Gemini    | Lightweight 2.5 model, tuned for efficiency                                 | **\$0.10 / \$0.40**              |
| mistral-small-latest  | Mistral   | Multilingual and multimodal Apache 2.0 model, 32k token context             | **\$0.10 / \$0.30**              |
| ministral-8b-latest   | Mistral   | Powerful model for on-device use cases, 128k token context                  | **\$0.10 / \$1.00**              |
| gpt-4.1-nano          | ChatGPT   | Ultra-light model for micro-tasks                                           | **\$0.10 / \$0.40**              |
| gpt-4o-mini           | ChatGPT   | Fast and affordable multimodal model                                        | **\$0.15 / \$0.60**              |
| gpt-4.1-mini          | ChatGPT   | Efficient model with faster latency and reduced cost                        | **\$0.40 / \$1.60**              |
| mistral-medium-latest | Mistral   | Cost-efficient enterprise-level performance, 128k token context             | **\$0.40 / \$2.00**              |
| magistral-small-latest| Mistral   | Multilingual reasoning model, 40k token context                             | **\$0.50 / \$1.50**              |
| gpt-3.5-turbo         | ChatGPT   | Fast, general-purpose model for basic conversation and summarization        | **\$1.00 / \$2.00**              |
| gemini-2.5-pro        | Gemini    | Premium model for advanced reasoning, coding, and analysis                  | **\$1.25–2.50 / \$10.00–15.00**  |
| magistral-medium-latest| Mistral  | High-end multilingual reasoning, 128k token context                         | **\$2.00 / \$5.00**              |
| mistral-large-latest  | Mistral   | Solves complex tasks with high quality, 128k token context                  | **\$2.00 / \$6.00**              |
| gpt-4.1               | ChatGPT   | Stronger reasoning, faster than GPT-4, versatile                            | **\$2.00 / \$8.00**              |
| gemini-2.5-flash      | Gemini    | Hybrid reasoning model for speed and broad media support                    | **\$0.30 / \$2.50**              |
| gpt-4o                | ChatGPT   | Top-tier multimodal model (text, image, audio), fast with high accuracy     | **\$2.50 / \$10.00**             |
| gpt-4                | ChatGPT   | High-quality reasoning and understanding, best for difficult tasks          | **\$30.00 / \$60.00**            |""")

        with tab_llama:
            st.image(
                "https://content.pstmn.io/d776e89b-2248-4c3f-a942-2eef03064755/b2xsYW1hLmpwZw==",
                width=500,
            )
            st.text(
                "Ollama is a local LLM provider, allowing you to run models on your own machine. Best for privacy and control."
            )
            cols = st.columns(2)
            with cols[0]:
                ollama_server = settings.get("ollama_server", "http://localhost:11434")
                new_ollama_server = st.text_input(
                    "Ollama URL",
                    value=ollama_server,
                    help="Enter the URL of your Ollama server. (http://ollama:11434 to use the local Ollama server)",
                )
                if new_ollama_server != ollama_server:
                    settings["ollama_server"] = new_ollama_server
                    apply_settings(settings)

                with st.spinner("Checking Ollama server...", show_time=True):
                    response = requests.get("http://back:80/ollama/test_url")
                if response.status_code == 200:
                    st.success("✅ Ollama server is valid.")
                else:
                    st.error("❌ Ollama server is not reachable.")

                model_pull_name = st.text_input(
                    "Model to install",
                    help="Enter the name of the model to pull from Ollama.",
                )
                st.caption(
                    "See available models at this link: https://ollama.com/library"
                )
                if st.button("Pull Model", use_container_width=True):
                    with st.spinner("Pulling model...", show_time=True):
                        if model_pull_name:
                            result = requests.post(
                                f"http://back:80/ollama/pull/{model_pull_name}"
                            )
                            if result.status_code == 200:
                                st.toast(
                                    f"Model '{model_pull_name}' pulled successfully.",
                                    icon="✅",
                                )
                                installed_models = requests.get(
                                    "http://back:80/ollama/list"
                                ).json()
                            else:
                                st.toast(
                                    f"Failed to pull model '{model_pull_name}'. Please try again.",
                                    icon="❌",
                                )
                        else:
                            st.warning("Please enter a model name to pull.")
            with cols[1]:
                st.subheader("Installed Models:")
                if installed_models:
                    for model in installed_models:
                        st.badge(model)
                else:
                    st.warning("Ollama is not available.")

        with tab_mistral:
            st.image(
                "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRBaT-xYST2LGo0lrPbyAltLhwLXcWTjCs2yg&s",
                width=300,
            )
            st.text(
                "Mistral AI is a leading provider of open-weight LLMs, offering a range of models for various tasks. And it's French 🇫🇷"
            )
            mistral_api_key = settings.get("mistral_api_key", "")
            new_mistral_api_key = st.text_input(
                "Mistral API Key",
                value=mistral_api_key,
                type="password",
                help="Enter your Mistral API key to use Mistral models.",
                key="mistral_api_key",
            )
            if new_mistral_api_key != mistral_api_key:
                settings["mistral_api_key"] = new_mistral_api_key
                apply_settings(settings)

        with tab_chatgpt:
            st.image(
                "https://www.logicgate.com/wp-content/smush-webp/plt-openai-01-hero-01.png.webp",
                width=300,
            )
            st.text(
                "OpenAI provides a range of powerful LLMs, including the popular ChatGPT models. Best for general-purpose tasks. American 🇺🇸 with a bit of privacy controversy."
            )
            openai_api_key = settings.get("openai_api_key", "")
            new_openai_api_key = st.text_input(
                "OpenAI API Key",
                value=openai_api_key,
                type="password",
                help="Enter your OpenAI API key to use ChatGPT models.",
                key="openai_api_key",
            )
            if new_openai_api_key != openai_api_key:
                settings["openai_api_key"] = new_openai_api_key
                apply_settings(settings)

        with tab_gemini:
            st.image(
                "https://lh3.googleusercontent.com/1E500rkSh8Gqkz2l12tkrKkMgsDmbQot0h3afeiRukXNficphb2zEE8o6J3dSKkiDGOOCcQ8WtRYzEYudgiYK9FkoQeYg_SP92-C=e365-pa-nu-w1200",
                width=300,
            )
            st.text(
                "Google Gemini is a powerful LLM provider, offering advanced models for complex tasks. Best for multimodal tasks and reasoning. American 🇺🇸 with a big monopoly on high tech."
            )
            gemini_api_key = settings.get("gemini_api_key", "")
            new_gemini_api_key = st.text_input(
                "Google Gemini API Key",
                value=gemini_api_key,
                type="password",
                help="Enter your Google Gemini API key to use Gemini models.",
                key="gemini_api_key",
            )
            if new_gemini_api_key != gemini_api_key:
                settings["gemini_api_key"] = new_gemini_api_key
                apply_settings(settings)

        with tab_groq:
            st.image("https://cdn.sanity.io/images/chol0sk5/production/ce0b2266373b3c9722b0bccb9a98441c26c89696-1200x630.png", width=300)
            st.text(
                "Groq provides ultra-fast inference for Whisper transcription models. Ideal for fast and accurate audio transcription."
            )
            groq_api_key = settings.get("groq_api_key", "")
            new_groq_api_key = st.text_input(
                "Groq API Key",
                value=groq_api_key,
                type="password",
                help="Enter your Groq API key to use Groq transcription models.",
                key="groq_api_key",
            )
            if new_groq_api_key != groq_api_key:
                settings["groq_api_key"] = new_groq_api_key
                apply_settings(settings)

        if len(groq_api_key) > 0:
            with tab_groq:
                with st.spinner("Checking Groq key...", show_time=True):
                    try:
                        headers = {"Authorization": f"Bearer {groq_api_key}"}
                        response = requests.get(
                            "https://api.groq.com/openai/v1/models",
                            headers=headers,
                            timeout=10,
                        )
                        if response.status_code == 200:
                            st.success("Groq API key is valid.", icon="✅")
                        else:
                            st.error("Groq API key is invalid.", icon="❌")
                            st.toast("Groq API key is invalid.", icon="❌")
                    except requests.RequestException as e:
                        st.toast(f"Groq check failed: {e}", icon="⚠️")

        if len(mistral_api_key) > 0:
            with tab_mistral:
                with st.spinner("Checking Mistral key...", show_time=True):
                    try:
                        headers = {"Authorization": f"Bearer {mistral_api_key}"}
                        response = requests.get(
                            "https://api.mistral.ai/v1/models",
                            headers=headers,
                            timeout=10,
                        )
                        if response.status_code == 200:
                            st.success("Mistral API key is valid.", icon="✅")
                        else:
                            st.error("Mistral API key is invalid.", icon="❌")
                            st.toast("Mistral API key is invalid.", icon="❌")
                    except requests.RequestException as e:
                        st.toast(f"Mistral check failed: {e}", icon="⚠️")

        if len(openai_api_key) > 0:
            with tab_chatgpt:
                with st.spinner("Checking OpenAI key...", show_time=True):
                    try:
                        headers = {"Authorization": f"Bearer {openai_api_key}"}
                        response = requests.get(
                            "https://api.openai.com/v1/models",
                            headers=headers,
                            timeout=10,
                        )
                        if response.status_code == 200:
                            st.success("OpenAI API key is valid.", icon="✅")
                        else:
                            st.error("OpenAI API key is invalid.", icon="❌")
                            st.toast("OpenAI API key is invalid.", icon="❌")
                    except requests.RequestException as e:
                        st.toast(f"OpenAI check failed: {e}", icon="⚠️")

        if len(gemini_api_key) > 0:
            with tab_gemini:
                with st.spinner("Checking Gemini key...", show_time=True):
                    try:
                        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={gemini_api_key}"
                        response = requests.get(url, timeout=10)
                        if response.status_code == 200:
                            st.success("Google Gemini API key is valid.", icon="✅")
                        else:
                            st.error("Google Gemini API key is invalid.", icon="❌")
                            st.toast("Google Gemini API key is invalid.", icon="❌")
                    except requests.RequestException as e:
                        st.toast(f"Gemini check failed: {e}", icon="⚠️")


if __name__ == "__main__":
    settings()

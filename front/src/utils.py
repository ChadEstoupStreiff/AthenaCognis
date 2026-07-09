import base64
import json
import mimetypes
import os
import random
import tempfile
from pathlib import Path
from typing import List
from urllib.parse import quote

import emoji
import numpy as np
import pandas as pd
import requests
import streamlit as st
import tifffile

map_languauge_extension = {
    "py": "python",
    "js": "javascript",
    "ts": "typescript",
    "java": "java",
    "c": "c",
    "cpp": "cpp",
    "csharp": "csharp",
    "html": "html",
    "css": "css",
    "yaml": "yaml",
    "bash": "bash",
    "sh": "bash",
    "sql": "sql",
    "php": "php",
    "ruby": "ruby",
    "go": "go",
    "rust": "rust",
    "kotlin": "kotlin",
    "swift": "swift",
    "env": "env",
    "toml": "toml",
}
mimes = [
    "text/plain",
    "text/markdown",
    "text/html",
    "text/csv",
    "text/x-python",
    "text/x-r",
    "text/x-sql",
    "text/x-latex",
    "text/x-shellscript",
    "text/x-csrc",
    "text/x-java-source",
    # Documents
    "application/pdf",
    "application/rtf",
    "application/epub+zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/x-iwork-keynote-sffkey",
    "application/x-iwork-pages-sffpages",
    "application/x-iwork-numbers-sffnumbers",
    # Images
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/tiff",
    "image/bmp",
    "image/svg+xml",
    # Audio
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/flac",
    "audio/aac",
    "audio/x-ms-wma",
    # Video
    "video/mp4",
    "video/avi",
    "video/mov",
    "video/webm",
    "video/x-ms-wmv",
    "video/x-flv",
    "video/mpeg",
    # Archives / disk images
    "application/zip",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-bzip",
    "application/x-bzip2",
    "application/x-iso9660-image",
    # Code / binaries
    "application/json",
    "application/javascript",
    "application/x-python-code",
    "application/x-httpd-php",
    "application/x-sh",
    "application/x-bash",
    "application/x-csh",
    "application/xml",
    "application/octet-stream",
    "application/x-msdownload",
]
mimes_map = {
    # Text / markup
    "text/plain": "Text",
    "text/markdown": "Markdown File",
    "text/html": "HTML File",
    "text/csv": "CSV File",
    "text/x-python": "Python Script",
    "text/x-r": "R Script",
    "text/x-sql": "SQL Script",
    "text/x-latex": "LaTeX File",
    "text/x-shellscript": "Shell Script",
    "text/x-csrc": "C Source File",
    "text/x-java-source": "Java Source File",
    # Documents
    "application/pdf": "PDF",
    "application/rtf": "RTF Document",
    "application/epub+zip": "EPUB Document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word Document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel Spreadsheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint Presentation",
    "application/vnd.ms-excel": "Excel Spreadsheet (Legacy)",
    "application/vnd.ms-powerpoint": "PowerPoint Presentation (Legacy)",
    "application/x-iwork-keynote-sffkey": "Keynote Presentation",
    "application/x-iwork-pages-sffpages": "Pages Document",
    "application/x-iwork-numbers-sffnumbers": "Numbers Spreadsheet",
    # Images
    "image/jpeg": "JPEG Image",
    "image/png": "PNG Image",
    "image/gif": "GIF Image",
    "image/webp": "WebP Image",
    "image/tiff": "TIFF Image",
    "image/bmp": "Bitmap Image",
    "image/svg+xml": "SVG Vector Image",
    # Audio
    "audio/mpeg": "MP3 Audio",
    "audio/wav": "WAV Audio",
    "audio/ogg": "OGG Audio",
    "audio/flac": "FLAC Audio",
    "audio/aac": "AAC Audio",
    "audio/x-ms-wma": "WMA Audio",
    # Video
    "video/mp4": "MP4 Video",
    "video/avi": "AVI Video",
    "video/mov": "MOV Video",
    "video/webm": "WebM Video",
    "video/x-ms-wmv": "WMV Video",
    "video/x-flv": "FLV Video",
    "video/mpeg": "MPEG Video",
    # Archives / disk images
    "application/zip": "ZIP Archive",
    "application/x-7z-compressed": "7z Archive",
    "application/x-rar-compressed": "RAR Archive",
    "application/x-tar": "TAR Archive",
    "application/gzip": "GZ Archive",
    "application/x-bzip": "BZIP Archive",
    "application/x-bzip2": "BZIP2 Archive",
    "application/x-iso9660-image": "ISO Disk Image",
    # Code / binaries
    "application/json": "JSON File",
    "application/javascript": "JavaScript File",
    "application/x-python-code": "Compiled Python Code",
    "application/x-httpd-php": "PHP File",
    "application/x-sh": "Shell Script",
    "application/x-bash": "Bash Script",
    "application/x-csh": "C-Shell Script",
    "application/xml": "XML File",
    "application/octet-stream": "Binary File",
    "application/x-msdownload": "Windows Executable",
}
mimes_map_compressed = {
    "🎨 images": (
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/tiff",
        "image/bmp",
        "image/svg+xml",
    ),
    "📄 documents": (
        "application/pdf",
        "application/rtf",
        "application/epub+zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    "🎵 audio": (
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/flac",
        "audio/aac",
        "audio/x-ms-wma",
    ),
    "🎬 video": (
        "video/mp4",
        "video/avi",
        "video/mov",
        "video/webm",
        "video/x-ms-wmv",
        "video/x-flv",
        "video/mpeg",
    ),
    "📝 text": (
        "text/plain",
        "text/markdown",
        "text/html",
        "text/csv",
        "text/x-python",
        "text/x-r",
        "text/x-sql",
        "text/x-latex",
        "text/x-shellscript",
        "text/x-csrc",
        "text/x-java-source",
    ),
    "🗄 archives": (
        "application/zip",
        "application/x-7z-compressed",
        "application/x-rar-compressed",
        "application/x-tar",
        "application/gzip",
        "application/x-bzip",
        "application/x-bzip2",
        "application/x-iso9660-image",
    ),
    "💻 code": (
        "application/json",
        "application/javascript",
        "application/x-python-code",
        "application/x-httpd-php",
        "application/x-sh",
        "application/x-bash",
        "application/x-csh",
        "application/xml",
        "application/octet-stream",
        "application/x-msdownload",
    ),
}


def delete_file(file_name: str):
    """
    Delete a file from the server.
    """
    encoded_file_name = quote(file_name)
    result = requests.delete(f"http://back:80/files/delete/{encoded_file_name}")

    requests.delete("http://back:80/stockpile/recentadded?file=" + encoded_file_name)
    requests.delete("http://back:80/stockpile/recentopened?file=" + encoded_file_name)

    return result


def get_setting(key: str, default=None):
    result = requests.get(f"http://back:80/settings/{key}")
    if result.status_code == 200:
        return result.json()
    else:
        st.error(f"Failed to retrieve setting {key}: {result.text}")
        return default
    
def set_setting(key: str, value):
    result = requests.post(f"http://back:80/settings/{key}", json={"value": value})
    if result.status_code != 200:
        st.error(f"Failed to set setting {key}: {result.text}")


def display_file(file_path: str, default_height_if_needed: int = 1000):
    file_extension = file_path.split(".")[-1].lower()
    mime = guess_mime(file_path)

    if not os.path.exists(file_path):
        st.error(f"File {file_path} does not exist.")
        return

    try:
        if (
            file_extension == "xlsx"
            or file_extension == "xls"
            or file_extension == "ods"
            or file_extension == "xlsm"
            or file_extension == "csv"
        ):
            st.dataframe(
                pd.read_csv(file_path),
                use_container_width=True,
                height=1000,
                key=f"dataframe_{file_path}",
            )

        if file_extension.lower() in ("tif", "tiff"):
            try:
                with tifffile.TiffFile(file_path) as tif:
                    if len(tif.pages) == 0:
                        frame = 0
                    else:
                        frame = st.slider("Select frame", 0, len(tif.pages) - 1)
                    img = tif.pages[frame].asarray()

                    if np.issubdtype(img.dtype, np.floating):
                        img = np.clip(img, 0, 1)  # floats expected in [0, 1]
                    else:
                        img_min, img_max = img.min(), img.max()
                        if img_max > 255 or img_min < 0:
                            img = (img - img_min) / (
                                img_max - img_min
                            )  # normalize to [0,1]
                            img = (img * 255).astype(np.uint8)

                    st.image(img, use_container_width=True)

            except Exception as e:
                st.error(f"File might be corrupted or not supported. Error: {e}")

        else:
            with open(file_path, "rb") as file:
                file_bytes = file.read()

                if file_extension == "md" or file_extension == "markdown":
                    st.markdown(file_bytes.decode("utf-8"), unsafe_allow_html=True)

                elif file_extension == "json":
                    st.json(json.loads(file_bytes.decode("utf-8")))

                elif file_extension in map_languauge_extension:
                    st.markdown(
                        f"Code: `{map_languauge_extension[file_extension]}`",
                    )
                    language = map_languauge_extension[file_extension]
                    st.code(
                        file_bytes.decode("utf-8"),
                        language=language,
                    )

                elif file_extension == "pdf":
                    media_type, _ = mimetypes.guess_type(file_path)
                    if not media_type:
                        media_type = "application/octet-stream"
                    encoded_content_string = base64.b64encode(file_bytes).decode(
                        "utf-8"
                    )
                    data_uri = f"data:{media_type};base64,{encoded_content_string}"
                    st.markdown(
                        f'<embed src="{data_uri}" width="100%" height="{default_height_if_needed}px" />',
                        unsafe_allow_html=True,
                    )

                elif mime.startswith("image/"):
                    st.image(file_bytes, use_container_width=True)

                elif mime.startswith("text/"):
                    st.code(
                        file_bytes.decode("utf-8"),
                    )

                elif mime.startswith("audio/"):
                    st.audio(file_bytes, format="audio/wav")

                elif mime.startswith("video/"):
                    st.video(file_bytes, format="video/mp4")

                else:
                    if not st.toggle("Force read (read as utf-8)"):
                        st.error(
                            f"Can't load a preview for this file type. {file_extension} is not supported."
                        )
                    else:
                        if st.toggle("Read as hex"):
                            st.code(
                                file_bytes.hex(),
                            )
                        else:
                            st.code(
                                file_bytes.decode("utf-8"),
                            )
    except Exception as e:
        st.error(
            f"File might be corrupted or not supported. Error displaying file: {str(e)}"
        )


def download_and_display_file(file_name, default_height_if_needed=1000):
    encoded_file_name = quote(file_name)
    size = requests.get(f"http://back:80/files/metadata/{encoded_file_name}")
    size = size.json().get("size", 0) / (1024 * 1024) if size.status_code == 200 else -1
    size_limit = get_setting("auto_display_file_size_limit")
    if (
        size < 0
        or size < size_limit
        or st.toggle(
            "This file exceeds the size limit. Display anyway?",
            value=False,
            key=f"display_large_file_toggle_{file_name}",
            help=f"The file is over {size_limit:.1f} MB. Toggle to allow display.",
        )
    ):
        with st.spinner("Displaying file...", show_time=True):
            file_url = f"http://back:80/files/download/{encoded_file_name}"
            result = requests.get(file_url)
            if result.status_code != 200:
                return None
            result = result.content

            if result is not None:
                file_extension = os.path.splitext(file_name)[1].lower()
                with tempfile.NamedTemporaryFile(
                    delete=True, suffix=f".{file_extension}"
                ) as fp:
                    fp.write(result)
                    fp.flush()
                    fp.seek(0)
                    display_file(
                        fp.name,
                        default_height_if_needed,
                    )


def download_and_display_preview(file_name: str):
    encoded_file_name = quote(file_name)
    result = requests.get(f"http://back:80/preview/{encoded_file_name}")

    if result.status_code == 404:
        if st.button(
            "Generate preview",
            key=f"gen_preview_{file_name}",
            use_container_width=True,
        ):
            requests.post(f"http://back:80/preview/generate/{encoded_file_name}")
            st.toast("Preview queued!", icon="🖼️")
        return

    if result.status_code != 200:
        st.caption("Preview unavailable")
        return

    content_type = result.headers.get("content-type", "")

    if content_type.startswith("image/"):
        st.image(result.content, use_container_width=True)
    elif content_type.startswith("text/"):
        st.code(result.text, language=None)
    else:
        st.caption("Preview unavailable")


def download_file_button(file: str):
    file_name = os.path.basename(file)
    if (
        f"prepare_download_{file}" not in st.session_state
        or not st.session_state[f"prepare_download_{file}"]
    ):
        def prepare_download_click_button():
            st.session_state[f"prepare_download_{file}"] = True

        st.button(
            "⬇️",
            help="Click to prepare the file for download.",
            use_container_width=True,
            key=f"button_prepare_download_{file}",
            on_click=prepare_download_click_button,
        )
    else:
        with st.spinner("Preparing file...", show_time=True):
            response = requests.get(f"http://back:80/files/download/{file}")
        if response.status_code == 200:
            with tempfile.NamedTemporaryFile(delete=True) as tmp_file:
                tmp_file.write(response.content)
                tmp_file.flush()
                tmp_file.seek(0)

                def download_click_button():
                    del st.session_state[f"prepare_download_{file}"]

                st.download_button(
                    "📥",
                    tmp_file.read(),
                    file_name=file_name,
                    help="Click to download the file.",
                    use_container_width=True,
                    key=f"see_download_{file}",
                    on_click=download_click_button,
                )


def generate_tag_visual_markdown(name: str, color: str):
    def get_contrasting_text_color(hex_color: str) -> str:
        hex_color = hex_color.lstrip("#")
        r, g, b = [int(hex_color[i : i + 2], 16) for i in (0, 2, 4)]
        luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return "black" if luminance > 128 else "white"

    """
    Generate a visual representation of a tag with its name and color.
    """
    text_color = get_contrasting_text_color(color)
    return f"""<span style="background-color:{color}; color:{text_color}; padding:4px 8px; border-radius:6px; font-size:0.9em;">{name}</span>"""


def generate_aside_tag_markdown(names: List[str], colors: List[str]):
    return f"""
    <div style="display: flex; flex-direction: raw; flex-wrap: wrap; gap: 8px; margin: 6px;">
        {"".join(generate_tag_visual_markdown(name, color) for name, color in zip(names, colors))}
    </div>
    """


def generate_project_visual_markdown(name: str, color: str):
    """
    Generate a visual representation of a project with its name and color.
    """
    return f"<span style='color:{color}; font-weight:bold'>{name}</span>"


def generate_aside_project_markdown(names: List[str], colors: List[str]):
    return f"""
    <div style="display: flex; flex-direction: raw; flex-wrap: wrap; gap: 8px; margin: 6px;">
        {"".join(generate_project_visual_markdown(name, color) for name, color in zip(names, colors))}
    </div>
    """


def generate_badges_html(
    file_list,
    color: str = "rgb(96, 180, 255)",
    bg_color: str = "rgba(61, 157, 243, 0.3)",
):
    style = (
        f"background-color: {bg_color};"
        f"color: {color};"
        "font-size: 0.875rem;"
        "border-radius: 0.25rem;"
        "padding: 0px 0.25rem;"
        "margin: 0px 1px;"
        "white-space: nowrap;"
        "overflow: hidden;"
        "text-overflow: ellipsis;"
        "margin: 3px 5px;"
        "max-width: 100%;"
        "display: inline-block;"
        "vertical-align: middle;"
        "font-family: 'Source Sans Pro', sans-serif;"
    )
    tag_template = f'<span style="{style}" class="is-badge">{{}}</span>'
    tags_html = "".join([tag_template.format(file) for file in file_list])
    return f'<div style="display:flex; flex-wrap:wrap;">{tags_html}</div>'


def spacer(space: int = 30):
    """
    Add a spacer to the Streamlit app.
    """
    st.markdown(f"""<div style="margin: {space}px"/>""", unsafe_allow_html=True)


def custom_style():
    """
    Apply custom CSS styles to the Streamlit app.
    """
    st.markdown(
        """
        <style>
        #MainMenu {visibility: hidden;}
        </style>
        """,
        unsafe_allow_html=True,
    )


def toast_for_rerun(message: str, icon: str = None):
    if "toast_for_rerun" not in st.session_state:
        st.session_state.toast_for_rerun = []
    st.session_state.toast_for_rerun.append((message, icon))


def clear_cache():
    if "explorer_files" in st.session_state:
        del st.session_state.explorer_files
    if "file_to_see" in st.session_state:
        del st.session_state.file_to_see
    if "note_name" in st.session_state:
        del st.session_state.note_name
    if "note_content" in st.session_state:
        del st.session_state.note_content


def guess_mime(file_name: str) -> str:
    """
    Guess the MIME type of a file based on its name, with custom overrides.
    """
    ext = file_name.lower().split(".")[-1]

    custom_mime = {
        "md": "text/markdown",
        "markdown": "text/markdown",
        "env": "text/env",
        "yaml": "text/x-yaml",
        "yml": "text/x-yaml",
        "toml": "text/toml",
        "ipynb": "application/x-ipynb+json",
        "jsonl": "application/x-ndjson",
        "log": "text/log",
        "logs": "text/log",
        "webp": "image/webp",
    }

    if ext in custom_mime:
        return custom_mime[ext].strip()

    mime, _ = mimetypes.guess_type(file_name)
    return mime.strip() if mime is not None else "application/octet-stream"


def refractor_text_area(
    label: str,
    value: str = "",
    context: str = None,
    key: str = None,
    height: int = 300,
    label_visibility: str = "visible",
    on_change=None,
    args: List = None,
    help: str = None,
):
    """
    Create a text area with a specific height and label.
    """
    if f"refractor_ask_question_{key}" not in st.session_state:
        st.session_state[f"refractor_ask_question_{key}"] = False
    with st.container(border=True):
        result = st.text_area(
            label=label,
            value=value,
            key=key,
            height=height,
            help=help,
            label_visibility=label_visibility,
            on_change=on_change,
            args=args,
        )
        cols = st.columns(4)

        question = None
        with cols[0]:
            if st.button("⚡ Brief", key=f"search_{key}", use_container_width=True):
                question = "Brief and summarize this text:"
        with cols[1]:
            if st.button(
                "🔄 Rewrite", key=f"refractor_{key}", use_container_width=True
            ):
                question = "Rewrite and improve this text:"
        with cols[2]:
            if st.button("🤖 Improve", key=f"improve_{key}", use_container_width=True):
                question = "Give more details and improve this text:"
        with cols[3]:
            if st.button("❓ Ask", key=f"ask_{key}", use_container_width=True):
                st.session_state[
                    f"refractor_ask_question_{key}"
                ] = not st.session_state[f"refractor_ask_question_{key}"]
        if st.session_state[f"refractor_ask_question_{key}"]:
            with st.container(border=True):
                question_input = st.text_input(
                    "Personalize how to reformat this text.",
                    key=f"refractor_ask_question_input_{key}",
                    placeholder="How to reformat this text?",
                )
                if st.button(
                    "❓ Ask",
                    key=f"refractor_ask_question_submit_{key}",
                    use_container_width=True,
                ):
                    question = question_input.strip()

        if question:
            if context:
                question = f"{context}\n\n{question}"
            with st.spinner("Refractoring text...", show_time=True):
                refractor_result = requests.get(
                    "http://back:80/utils/ai/refractor?text="
                    + quote(result)
                    + "&question="
                    + quote(question)
                )

            if refractor_result.status_code == 200:
                proposition = refractor_result.json()
                with st.expander("Refractor proposition", expanded=True):
                    st.code(proposition, language="text", wrap_lines=True)
            else:
                st.error(f"Error during refractor: {refractor_result.text}")
    return result


def text_emoji_input(
    label: str,
    help: str = None,
    max_chars: int = None,
    key: str = "text_emoji_selector",
    value: str = "",
    ratio: List[int] = [1, 5],
):
    """
    Create a text input with an emoji selector.
    """
    if f"text_emoji_input_emoji_{key}" not in st.session_state:
        emojis = [(e, n["en"]) for (e, n) in emoji.EMOJI_DATA.items()]
        st.info("Random choice")
        st.session_state[f"text_emoji_input_emoji_{key}"] = random.choice(emojis)[0]
        st.session_state[f"text_emoji_input_pick_emoji_{key}"] = False

    def toggle_emoji_picker(key):
        st.session_state[f"text_emoji_input_pick_emoji_{key}"] = not st.session_state[
            f"text_emoji_input_pick_emoji_{key}"
        ]

    input_cols = st.columns(ratio)
    with input_cols[1]:
        text = st.text_input(
            label,
            key=f"text_emoji_input_text_{key}",
            value=value,
            help=help,
            max_chars=max_chars,
        )

    if st.session_state[f"text_emoji_input_pick_emoji_{key}"]:
        emojis = [(e, n["en"]) for (e, n) in emoji.EMOJI_DATA.items()]
        with st.container(border=True):
            search = st.text_input(
                "Search emoji",
                key=f"emoji_search_{key}",
                placeholder="Search for an emoji...",
            )
            if search:
                emojis = [
                    (e, n["en"])
                    for (e, n) in emoji.EMOJI_DATA.items()
                    if search.lower() in n["en"].lower()
                ]

            n_cols = 6
            emojis = emojis[: n_cols * 3]
            cols = st.columns(n_cols)
            for i, (emoji_char, _) in enumerate(emojis):
                with cols[i % n_cols]:
                    if st.button(
                        emoji_char,
                        use_container_width=True,
                        key=f"text_emoji_input_emojiselect_{key}_{emoji_char}",
                    ):
                        st.session_state[f"text_emoji_input_emoji_{key}"] = emoji_char

    with input_cols[0]:
        spacer(27)
        st.button(
            st.session_state[f"text_emoji_input_emoji_{key}"],
            key=f"text_emoji_input_emojipicker_{key}",
            use_container_width=True,
            on_click=lambda: toggle_emoji_picker(key),
        )

    return (
        f"{st.session_state[f'text_emoji_input_emoji_{key}']} {text}"
        if text
        else st.session_state[f"text_emoji_input_emoji_{key}"]
    )


def paths_to_markdown_tree(paths: List[str]) -> str:
    # Build a tree structure
    tree = {}
    for path in paths:
        parts = Path(path).parts
        d = tree
        for part in parts:
            d = d.setdefault(part, {})

    # Recursive printing in Markdown
    def print_tree(d, indent=0):
        md = ""
        for i, key in enumerate(sorted(d.keys())):
            prefix = "    " * indent + f"- **{key}**"
            md += prefix + "\n"
            if d[key]:  # has children
                md += print_tree(d[key], indent + 1)
        return md

    return print_tree(tree)


def generate_color(text: str) -> str:
    """
    Generate a color based on the text input.
    """
    hash_value = hash(text)
    r = (hash_value & 0xFF0000) >> 16
    g = (hash_value & 0x00FF00) >> 8
    b = hash_value & 0x0000FF
    return f"#{r:02X}{g:02X}{b:02X}"


def fmt_bytes(b):
    b = float(max(0, b))
    for u in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if b < 1024 or u == "PB":
            return f"{b:.2f} {u}"
        b /= 1024.0

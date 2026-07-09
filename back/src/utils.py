import json
import logging
import mimetypes
import os

import docx
from db import (
    OCR,
    Note,
    Project,
    ProjectFile,
    Summary,
    Tag,
    TagFile,
    Transcription,
    get_db,
)
from PyPDF2 import PdfReader


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


def read_content(
    file: str,
    force_read: bool = False,
    include_note: bool = True,
    include_projects: bool = False,
    include_tags: bool = False,
    include_summary: bool = False,
) -> str:
    """
    Read the content of a file and return it as a string.
    """
    content = None
    projects = None
    tags = None
    note = None
    summary = None
    keywords = None

    db = get_db()
    try:
        mime = guess_mime(file)
        # MARK: Image
        if mime.startswith("image/"):
            result = db.query(OCR).filter(OCR.file == file).first()
            if result is not None:
                ocr = "\n".join([item[1][0] for item in json.loads(result.ocr)])
                blip = result.blip
                if ocr and blip:
                    content = f"CAPTION: {blip}\nOCR: {ocr}"

        # MARK: Audio and Video
        elif mime.startswith("audio/") or mime.startswith("video/"):
            logging.info("SUMMARY >> Attempting to get transcription.")
            transcription = (
                db.query(Transcription).filter(Transcription.file == file).first()
            )
            if transcription is not None:
                transcription = transcription.transcription
                if transcription:
                    content = f"Transcription: {transcription}"

        # MARK: Text and JSON
        elif mime.startswith("text") or mime.endswith("json"):
            logging.info("SUMMARY >> Attempting to read text content.")
            with open(file, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

        # MARK: PDF
        elif mime == "application/pdf":
            logging.info("SUMMARY >> Attempting to read PDF content.")
            content = "\n".join(
                page.extract_text() or "" for page in PdfReader(file).pages
            )

        # MARK: Word
        elif mime in (
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ):
            logging.info("SUMMARY >> Attempting to read DOCX content.")
            doc = docx.Document(file)
            content = "\n".join(p.text for p in doc.paragraphs)

        elif force_read:
            with open(file, "r") as f:
                content = f.read()

        if include_projects:
            projects = (
                db.query(Project.name)
                .join(ProjectFile)
                .filter(ProjectFile.file == file)
                .all()
            )
            projects = [project.name for project in projects]
        if include_tags:
            tags = db.query(Tag.name).join(TagFile).filter(TagFile.file == file).all()
            tags = [tag.name for tag in tags]

        if include_note:
            note = db.query(Note).filter(Note.file == file).first()

        if include_summary:
            summary_result = db.query(Summary).filter(Summary.file == file).first()
            if summary_result:
                keywords = (
                    json.loads(summary_result.keywords)
                    if summary_result.keywords
                    else []
                )
                summary = summary_result.summary

    except Exception as e:
        logging.error(f"Error retrieving projects or tags for file {file}: {str(e)}")
    finally:
        db.close()

    if content is None:
        logging.warning(f"Unable to read content from file: {file}")
        return None

    date = file.split("/")[1]
    subfolder = file.split("/")[2]
    return f"""
File Name: {os.path.basename(file)}
File Extension: {os.path.splitext(file)[1]}
MIME Type: {mime if mime else "Unknown"}
Date: {date}
Subfolder: {subfolder}
{f"Projects: {', '.join(projects) if projects else 'None'}"}
{f"Tags: {', '.join(tags) if tags else 'None'}"}

{f"Note: {note}\n" if note else ""}
{f"Summary: {summary if summary else "No summary available"}\n"}
{f"Keywords: {', '.join(keywords) if keywords else 'No keywords available'}\n"}
Content:
{content if content else "Can't read"}
"""


def walk_files():
    return [
        os.path.join(dp, filename)
        for dp, _, filenames in os.walk("/shared")
        for filename in filenames
        if filename != ".DS_Store"
    ]

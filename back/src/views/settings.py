import json
import logging
import traceback
from typing import Any

from db import Setting, get_db
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["Settings"])

default_settings = {
    # "summarization_model": "llama3.2:3b",
    # "summarization_model": "llama3.1:8b",
    "search_limit": 50,
    "search_default_timeframe_days": 30,
    "explorer_default_representation_mode": 1,  # 0: grid, 1: list, 2: table
    "projects_default_representation_mode": 1,  # 0: grid, 1: list, 2: table
    "chat_files_default_representation_mode": 0, # 0: grid, 1: list, 2: table
    "link_files_default_representation_mode": 0, # 0: grid, 1: list, 2: table
    "target_hourly_working_time": 7.5,
    "enable_auto_ocr": True,
    "enable_auto_transcription": True,
    "enable_auto_summary": True,
    "ollama_server": "http://ollama:11434",
    "blip_type": "local",
    "blip_model": "llava:7b",
    "ocr_type": "paddle",
    "ocr_model": "llava:7b",
    "transcription_type": "local",
    "transcription_model": "small",
    "summarization_type": "llama",
    "summarization_model": "llama3.2:1b",
    "chat_type": "llama",
    "chat_model": "llama3.2:1b",
    "refractor_type": "llama",
    "refractor_model": "llama3.2:1b",
    "auto_display_file_size_limit": 10,  # 10Mb
    "enable_auto_preview": True,
    "preview_quality": "medium",  # low=144p, medium=360p, high=720p
    "preview_text_chars": 300,
    "preview_zip_subfiles": 15,
    "link_type": "llama",
    "link_model": "llama3.2:1b",
    "mistral_api_key": "",
    "openai_api_key": "",
    "gemini_api_key": "",
    "groq_api_key": "",
    "telemetry_enabled": None,
    "telemetry_uuid": "",
    "telemetry_last_sent": "",
    "chat_user_description": "",
    "chat_presets": [
        [
            "📄 Generate Academic Summary",
            "Summarize this document as a formal academic abstract of no more than 250 words. Focus on the research objectives, key methods, major findings, and main conclusions. Use precise scientific language and avoid generalities.",
        ],
        [
            "📝 Create Publication Draft",
            "Transform the content of this document into a structured scientific manuscript. Include the following labeled sections: Introduction (with background and research question), Methods (detailing experimental or analytical techniques), Results (highlighting key quantitative/qualitative findings), and Discussion (interpreting the results and situating them in the existing literature). Aim for clarity, scientific rigor, and logical flow.",
        ],
        [
            "📰 Generate Newsletter",
            "Write a clear and engaging newsletter article (max 300 words) summarizing the key takeaways of this document. Use accessible language for an educated but non-specialist audience. Highlight the problem addressed, the main result, and its implications or applications.",
        ],
        [
            "🎯 Write Conference Poster Text",
            "Extract the essential content needed for a scientific conference poster. Provide a concise and compelling version of the Title, Introduction (2–3 sentences), Methods (1–2 sentences), Key Results (bullet points), and Conclusion/Takeaway message (1–2 sentences). Prioritize clarity and visual-friendly formatting.",
        ],
        [
            "📊 Make Slide Outline",
            "Create a slide-by-slide outline for a scientific or technical presentation based on this document. Specify slide titles and bullet points per slide. Organize content logically: Introduction, Background, Objectives, Methods, Results, Discussion, and Conclusion. Include a final slide for future directions or questions.",
        ],
        [
            "📢 Create Social Media Post",
            "Generate a tweet (280 characters max) and a LinkedIn post (around 600 characters) that summarize the main findings or message of this document. Make them informative, engaging, and suitable for a scientific audience. Optionally include hashtags or a call to action.",
        ],
        [
            "💼 Draft Résumé Section",
            "Extract relevant experience, responsibilities, techniques used, and achievements from this document to write a CV/résumé section. Format as bullet points under a suitable heading. Tailor the phrasing for academic, scientific, or technical job applications.",
        ],
        [
            "✍️ Write Blog Article",
            "Turn this document into an accessible, well-structured blog article (around 500 words) aimed at a general science-literate audience. Explain the background, main question, key findings, and their broader significance. Use clear language and an engaging tone while preserving scientific accuracy.",
        ],
        [
            "📬 Summarize for Supervisor",
            "Write a short, professional update message to a PhD or project supervisor, summarizing the main progress, findings, or conclusions of this document. Focus on clarity, technical accuracy, and efficient communication. Limit to 150–200 words.",
        ],
        [
            "🗞️ Generate Press Release",
            "Write a press release (around 300 words) for a general audience based on this document. Start with a compelling headline and opening paragraph. Emphasize the problem addressed, what was discovered, and why it matters. Avoid jargon, and include a quote from a fictional spokesperson or lead researcher if appropriate.",
        ],
    ],
}


def format_value(value: Any) -> str:
    """
    Format the value based on its type.
    """
    if isinstance(value, bool):
        return f"bool:{str(value).lower()}"
    elif isinstance(value, int):
        return f"int:{value}"
    elif isinstance(value, str):
        if value.startswith("{") or value.startswith("["):
            return f"json:{value}"
        return f"str:{value.strip()}"
    return f"json:{json.dumps(value)}"  # Default to JSON format for other types


def parse_value(value: str) -> Any:
    """
    Parse the value from the database to its appropriate type.
    """
    if value.startswith("bool:"):
        return value[5:].lower() in ("true", "1", "yes")
    elif value.startswith("int:"):
        return int(value[4:])
    elif value.startswith("str:"):
        return value[4:].strip()
    return json.loads(value[5:])  # Default to JSON parsing for other types


def get_setting(key: str, default=None):
    """
    Get a setting value by key, returning the default if not found.
    """
    db = get_db()
    try:
        setting = db.query(Setting).filter(Setting.key == key).first()
        return (
            parse_value(setting.value)
            if setting
            else default_settings.get(key, default)
        )
    except Exception as e:
        logging.error(f"Error retrieving setting {key}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving setting {key}: {str(e)}"
        )
    finally:
        db.close()


# MARK: SETTINGS


@router.get("/settings/{key}")
async def get_setting_value(key: str):
    """
    Get a specific setting value by key.
    """
    try:
        value = get_setting(key)
        if value is None:
            raise HTTPException(status_code=404, detail=f"Setting {key} not found.")
        return value
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving setting {key}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving setting {key}: {str(e)}"
        )


class SettingValue(BaseModel):
    value: Any


@router.post("/settings/{key}")
async def set_setting_value(key: str, body: SettingValue):
    """
    Set a specific setting value by key.
    """
    db = get_db()
    try:
        setting = db.query(Setting).filter(Setting.key == key).first()
        if setting:
            setting.value = format_value(body.value)
        else:
            new_setting = Setting(key=key, value=format_value(body.value))
            db.add(new_setting)
        db.commit()
        return {"message": "Setting updated successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating setting {key}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error updating setting {key}: {str(e)}"
        )
    finally:
        db.close()


@router.get("/settings")
async def get_settings():
    """
    Get the current settings.
    """
    db = get_db()
    try:
        result = {
            setting.key: parse_value(setting.value)
            for setting in db.query(Setting).all()
        }
        for key, value in default_settings.items():
            if key not in result:
                result[key] = value
        return result
    except Exception as e:
        logging.error(f"Error retrieving settings: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving settings: {str(e)}"
        )
    finally:
        db.close()


@router.post("/settings")
async def set_settings(settings: dict):
    """
    Set the current settings.
    """
    db = get_db()
    try:
        for key, value in settings.items():
            setting = db.query(Setting).filter(Setting.key == key).first()
            if setting:
                setting.value = format_value(value)
            else:
                new_setting = Setting(key=key, value=format_value(value))
                db.add(new_setting)
        db.commit()
        return {"message": "Settings updated successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating settings: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error updating settings: {str(e)}"
        )
    finally:
        db.close()

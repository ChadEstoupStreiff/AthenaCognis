from datetime import datetime
from pathlib import Path
from typing import Optional, TypedDict

from sqlalchemy.orm import Session

from controllers.JobManager import JobManager, run_python_script
from db import OCR, OCRTask, get_db
from tools.ai import request_vision_llm
from views.settings import get_setting

APP_DIR = Path("/app")
BLIP_SCRIPT = APP_DIR / "ocr_blip.py"
PADDLE_SCRIPT = APP_DIR / "ocr_paddle.py"
LOCAL_CAPTION_TYPES = ("local", "blip")
LOCAL_OCR_TYPES = ("paddle", "local")
CAPTION_PROMPT = "Describe this image in one or two concise sentences."
OCR_PROMPT = (
    "Extract all text visible in this image. "
    "Return only the raw text, preserving line breaks."
)


class OCRRecord(TypedDict):
    """Stored OCR text and caption of an image."""

    file: str
    date: datetime
    ocr: str
    blip: Optional[str]


class OCRManager(JobManager):
    """Caption (BLIP) and extract text (OCR) from images."""

    name = "OCR"
    task_model = OCRTask

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Caption an image, extract its text and add the OCR row

        Args:
            file (str): image path
            db (Session): session committed with the task completion
        Returns:
            str: caption and text, stored as the task result
        """
        caption = cls.caption(file)
        text = cls.extract_text(file)
        db.query(OCR).filter(OCR.file == file).delete()
        db.add(OCR(file=file, date=datetime.now(), ocr=text, blip=caption))
        return f"{caption} - {text}"

    @classmethod
    def caption(cls, file: str) -> str:
        """
        Describe an image with the configured captioning backend

        Args:
            file (str): image path
        Returns:
            str: caption
        """
        if get_setting("blip_type", "local") in LOCAL_CAPTION_TYPES:
            return run_python_script(BLIP_SCRIPT, file).capitalize()
        _, _, caption = request_vision_llm("blip", CAPTION_PROMPT, file)
        return str(caption)

    @classmethod
    def extract_text(cls, file: str) -> str:
        """
        Extract the text of an image with the configured OCR backend

        Args:
            file (str): image path
        Returns:
            str: extracted text (JSON list of lines for PaddleOCR)
        """
        if get_setting("ocr_type", "paddle") in LOCAL_OCR_TYPES:
            output = run_python_script(PADDLE_SCRIPT, file)
            return output[output.find("[") : output.rfind("]") + 1]
        _, _, text = request_vision_llm("ocr", OCR_PROMPT, file)
        return str(text)

    @classmethod
    def delete_results(cls, db: Session, file: str) -> None:
        """
        Delete the OCR row of a file

        Args:
            db (Session): session
            file (str): image path
        Returns:
            None
        """
        db.query(OCR).filter(OCR.file == file).delete()

    @classmethod
    def move_results(cls, db: Session, file: str, new_file: str) -> None:
        """
        Re-point the OCR row of a file to its new path

        Args:
            db (Session): session
            file (str): old image path
            new_file (str): new image path
        Returns:
            None
        """
        db.query(OCR).filter(OCR.file == file).update({OCR.file: new_file})

    @classmethod
    def get(cls, file: str) -> Optional[OCRRecord]:
        """
        Get the OCR result of a file

        Args:
            file (str): image path
        Returns:
            Optional[OCRRecord]: OCR result, None when absent
        """
        with get_db() as db:
            ocr = db.query(OCR).filter(OCR.file == file).first()
            if ocr is None:
                return None
            return OCRRecord(file=ocr.file, date=ocr.date, ocr=ocr.ocr, blip=ocr.blip)

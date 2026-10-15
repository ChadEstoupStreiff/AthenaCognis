from datetime import datetime
from pathlib import Path
from typing import Optional, TypedDict

from sqlalchemy.orm import Session

from controllers.JobManager import JobManager, run_python_script
from db import Transcription, TranscriptionTask, get_db
from tools.ai import request_transcription
from views.settings import get_setting

WHISPER_SCRIPT = Path("/app/whisper.py")
LOCAL_TRANSCRIPTION_TYPE = "local"


class TranscriptionRecord(TypedDict):
    """Stored transcription of an audio or video file."""

    file: str
    date: datetime
    transcription: str


class TranscriptionManager(JobManager):
    """Transcribe audio and video files."""

    name = "TRANSCRIPTION"
    task_model = TranscriptionTask

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Transcribe a media file and add the transcription row

        Args:
            file (str): media path
            db (Session): session committed with the task completion
        Returns:
            str: transcription, stored as the task result
        """
        transcription = cls.transcribe(file)
        db.query(Transcription).filter(Transcription.file == file).delete()
        db.add(
            Transcription(file=file, date=datetime.now(), transcription=transcription)
        )
        return transcription

    @classmethod
    def transcribe(cls, file: str) -> str:
        """
        Transcribe a media file with the configured backend

        Args:
            file (str): media path
        Returns:
            str: transcription
        """
        if get_setting("transcription_type", "local") == LOCAL_TRANSCRIPTION_TYPE:
            model = str(get_setting("transcription_model", "small"))
            return run_python_script(WHISPER_SCRIPT, model, file)
        _, _, transcription = request_transcription("transcription", file)
        return str(transcription)

    @classmethod
    def delete_results(cls, db: Session, file: str) -> None:
        """
        Delete the transcription row of a file

        Args:
            db (Session): session
            file (str): media path
        Returns:
            None
        """
        db.query(Transcription).filter(Transcription.file == file).delete()

    @classmethod
    def move_results(cls, db: Session, file: str, new_file: str) -> None:
        """
        Re-point the transcription row of a file to its new path

        Args:
            db (Session): session
            file (str): old media path
            new_file (str): new media path
        Returns:
            None
        """
        db.query(Transcription).filter(Transcription.file == file).update(
            {Transcription.file: new_file}
        )

    @classmethod
    def get(cls, file: str) -> Optional[TranscriptionRecord]:
        """
        Get the transcription of a file

        Args:
            file (str): media path
        Returns:
            Optional[TranscriptionRecord]: transcription, None when absent
        """
        with get_db() as db:
            row = db.query(Transcription).filter(Transcription.file == file).first()
            if row is None:
                return None
            return TranscriptionRecord(
                file=row.file, date=row.date, transcription=row.transcription
            )

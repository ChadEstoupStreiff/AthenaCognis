from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TypedDict

from sqlalchemy.orm import Session

from controllers.JobManager import JobManager, run_python_script
from db import Transcription, TranscriptionTask, get_db
from tools.ai import request_transcription
from views.settings import get_setting

APP_DIR = Path("/app")


@dataclass(frozen=True)
class LocalEngine:
    """Speech-to-text engine run in a subprocess inside the container."""

    script: Path
    default_model: str
    # Accepted models (None: any name the engine knows).
    models: tuple[str, ...] | None = None

    def pick_model(self, stored: object) -> str:
        """
        Use the stored model when this engine accepts it, else the engine default

        Args:
            stored (object): "transcription_model" setting
        Returns:
            str: model to run
        """
        if not isinstance(stored, str) or not stored:
            return self.default_model
        if self.models is not None and stored not in self.models:
            return self.default_model
        return stored


QWEN_ASR_MODELS = ("Qwen/Qwen3-ASR-0.6B", "Qwen/Qwen3-ASR-1.7B")
# Provider value (setting "transcription_type") → local engine.
LOCAL_ENGINES: dict[str, LocalEngine] = {
    "local": LocalEngine(APP_DIR / "whisper.py", "small"),
    "qwen_asr": LocalEngine(
        APP_DIR / "qwen_asr_transcribe.py", QWEN_ASR_MODELS[0], QWEN_ASR_MODELS
    ),
}


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
        engine = LOCAL_ENGINES.get(str(get_setting("transcription_type", "local")))
        if engine is not None:
            model = engine.pick_model(get_setting("transcription_model"))
            return run_python_script(engine.script, model, file)
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
    def get(cls, file: str) -> TranscriptionRecord | None:
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

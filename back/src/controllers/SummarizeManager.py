import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Type, TypedDict

from sqlalchemy.orm import Session

from controllers.JobManager import JobManager
from controllers.OCRManager import OCRManager
from controllers.TranscriptionManager import TranscriptionManager
from db import Summary, SummaryTask, TaskStateEnum, get_db
from tools.ai import request_llm
from utils import guess_mime, read_content

SETTING_PREFIX = "summarization"
CODE_FENCE = "```"
MISSING_TEXT_REASONS: Dict[Optional[TaskStateEnum], str] = {
    None: "run {job} first",
    TaskStateEnum.COMPLETED: "{job} found no text",
    TaskStateEnum.FAILED: "last {job} run failed",
}
UNFINISHED_REASON = "{job} not finished"
KEYWORDS_PROMPT = """"! FILE CONTENT START !
{input}
! FILE CONTENT END !

! TASK !
You are an expert summarizer.

Extract **5 to 10 relevant keywords** that capture the **main topics and themes** of the file content above.

! FORMAT !
Respond ONLY with a plain comma-separated list.  
Do NOT use JSON, code blocks, quotes, or formatting.  
Example: keyword1, keyword2, keyword3, ...
"""
SUMMARY_PROMPT = """"! FILE CONTENT START !
{input}
! FILE CONTENT END !

! TASK !
You are an expert summarizer.

Write a **summary** from the CONTENT of the file above. Maximum of **400 WORDS**. Focus on the main ideas and key points. Use clear and concise language.

! FORMAT !
Respond ONLY with plain markdown.  
Do NOT include explanations, notes, or any formatting outside the summary itself.
"""


class SummaryRecord(TypedDict):
    """Stored summary and keywords of a file."""

    file: str
    date: datetime
    summary: str
    keywords: List[str]


class JobInputError(Exception):
    """Raised when a file has no text to summarize."""


def parse_keywords(raw: str) -> List[str]:
    """
    Parse the keywords answered by the LLM (JSON list or comma-separated)

    Args:
        raw (str): LLM answer
    Returns:
        List[str]: keywords
    """
    if raw.startswith("[") and raw.endswith("]"):
        return [str(keyword) for keyword in json.loads(raw)]
    return [keyword.strip() for keyword in raw.split(",")]


def strip_code_fence(text: str) -> str:
    """
    Remove a markdown code fence wrapping a whole text

    Args:
        text (str): LLM answer
    Returns:
        str: unwrapped, stripped text
    """
    text = text.strip()
    if text.startswith(CODE_FENCE) and text.endswith(CODE_FENCE):
        return text[len(CODE_FENCE) : -len(CODE_FENCE)].strip()
    return text


class SummarizeManager(JobManager):
    """Summarize files; images and media wait for their OCR or transcription."""

    name = "SUMMARY"
    task_model = SummaryTask

    @classmethod
    def prerequisite_of(cls, file: str) -> Optional[Type[JobManager]]:
        """
        Get the job producing the text a file summary needs

        Args:
            file (str): file path
        Returns:
            Optional[Type[JobManager]]: OCR for images, transcription for media, None otherwise
        """
        mime = guess_mime(file)
        if mime.startswith("image/"):
            return OCRManager
        if mime.startswith(("audio/", "video/")):
            return TranscriptionManager
        return None

    @classmethod
    def is_waiting(cls, file: str) -> bool:
        """
        Tell whether the OCR or transcription of a file is still queued or running

        Args:
            file (str): file path
        Returns:
            bool: True to wait (re-queued by requeue_waiting when it finishes)
        """
        prerequisite = cls.prerequisite_of(file)
        return prerequisite is not None and prerequisite.has_open_task(file)

    @classmethod
    def requeue_waiting(cls, file: str) -> None:
        """
        Queue the summary of a file waiting for its OCR or transcription

        Args:
            file (str): file path
        Returns:
            None
        """
        if cls.has_open_task(file):
            cls.queue.put(file)

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Summarize a file and add the summary row

        Args:
            file (str): file path
            db (Session): session committed with the task completion
        Returns:
            str: keywords and summary, stored as the task result
        Raises:
            JobInputError: when the file has no readable text
        """
        content = read_content(file)
        if content is None:
            raise JobInputError(cls.missing_input_reason(file))
        keywords, summary = cls.make_summary(content)
        db.query(Summary).filter(Summary.file == file).delete()
        db.add(
            Summary(
                file=file,
                date=datetime.now(),
                summary=summary,
                keywords=json.dumps(keywords),
            )
        )
        return f"{keywords} - {summary}"

    @classmethod
    def missing_input_reason(cls, file: str) -> str:
        """
        Explain why a file has no text to summarize

        Args:
            file (str): file path
        Returns:
            str: error message
        """
        prerequisite = cls.prerequisite_of(file)
        if prerequisite is None:
            return f"Can't summarize this type of file: {file}"
        state = prerequisite.latest_state(file)
        reason = MISSING_TEXT_REASONS.get(state, UNFINISHED_REASON)
        return f"Nothing to summarize: {reason.format(job=prerequisite.name)}."

    @classmethod
    def make_summary(cls, content: str) -> Tuple[List[str], str]:
        """
        Ask the LLM for the keywords and summary of a text

        Args:
            content (str): text to summarize
        Returns:
            Tuple[List[str], str]: keywords and markdown summary
        """
        _, _, keywords = request_llm(
            setting_prefix=SETTING_PREFIX, prompt=KEYWORDS_PROMPT, input_text=content
        )
        _, _, summary = request_llm(
            setting_prefix=SETTING_PREFIX, prompt=SUMMARY_PROMPT, input_text=content
        )
        return parse_keywords(keywords), strip_code_fence(summary)

    @classmethod
    def delete_results(cls, db: Session, file: str) -> None:
        """
        Delete the summary row of a file

        Args:
            db (Session): session
            file (str): file path
        Returns:
            None
        """
        db.query(Summary).filter(Summary.file == file).delete()

    @classmethod
    def move_results(cls, db: Session, file: str, new_file: str) -> None:
        """
        Re-point the summary row of a file to its new path

        Args:
            db (Session): session
            file (str): old file path
            new_file (str): new file path
        Returns:
            None
        """
        db.query(Summary).filter(Summary.file == file).update({Summary.file: new_file})

    @classmethod
    def get(cls, file: str) -> Optional[SummaryRecord]:
        """
        Get the summary of a file

        Args:
            file (str): file path
        Returns:
            Optional[SummaryRecord]: summary, None when absent
        """
        with get_db() as db:
            row = db.query(Summary).filter(Summary.file == file).first()
            if row is None:
                return None
            return SummaryRecord(
                file=row.file,
                date=row.date,
                summary=row.summary,
                keywords=json.loads(row.keywords),
            )


OCRManager.listeners.append(SummarizeManager.requeue_waiting)
TranscriptionManager.listeners.append(SummarizeManager.requeue_waiting)

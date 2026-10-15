from typing import List, Optional, Tuple

import pytest
from conftest import SessionFactory
from sqlalchemy.orm import Session

from controllers.OCRManager import OCRManager
from controllers.SummarizeManager import SummarizeManager
from db.models import Summary, TaskStateEnum

IMAGE = "/shared/2026-10-15/uploads/scan.png"
OCR_RESULT = "caption - text"
KEYWORDS = ["scan"]
SUMMARY = "A scanned page."


def fake_ocr(cls: type, file: str, db: Session) -> str:
    """
    Pretend to OCR an image

    Args:
        cls (type): manager class
        file (str): image path
        db (Session): session
    Returns:
        str: OCR result
    """
    return OCR_RESULT


def fake_summary(cls: type, content: str) -> Tuple[List[str], str]:
    """
    Pretend to ask the LLM for a summary

    Args:
        cls (type): manager class
        content (str): text
    Returns:
        Tuple[List[str], str]: keywords and summary
    """
    return KEYWORDS, SUMMARY


def summary_state(file: str) -> Optional[TaskStateEnum]:
    """
    Get the latest summary task state of a file

    Args:
        file (str): file path
    Returns:
        Optional[TaskStateEnum]: state
    """
    return SummarizeManager.latest_state(file)


@pytest.fixture(autouse=True)
def fake_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Replace OCR and LLM calls; text exists only once OCR completed

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    monkeypatch.setattr(OCRManager, "process", classmethod(fake_ocr))
    monkeypatch.setattr(SummarizeManager, "make_summary", classmethod(fake_summary))
    monkeypatch.setattr(
        "controllers.SummarizeManager.read_content",
        lambda file: "text" if OCRManager.latest_state(file) == TaskStateEnum.COMPLETED else None,
    )


def test_summary_waits_for_ocr_then_runs(session_factory: SessionFactory) -> None:
    """
    Check a summary waits for the OCR of its image, then runs once OCR finishes

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    OCRManager.add_file_to_queue(IMAGE)
    SummarizeManager.add_file_to_queue(IMAGE)

    SummarizeManager.process_next()
    assert summary_state(IMAGE) == TaskStateEnum.PENDING
    assert SummarizeManager.queue.empty()

    OCRManager.process_next()
    assert SummarizeManager.queue.qsize() == 1

    SummarizeManager.process_next()
    assert summary_state(IMAGE) == TaskStateEnum.COMPLETED
    with session_factory() as db:
        assert db.get(Summary, IMAGE) is not None


def test_summary_without_ocr_fails_instead_of_staying_pending(
    session_factory: SessionFactory,
) -> None:
    """
    Check a summary of an image without OCR fails with a reason

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    SummarizeManager.add_file_to_queue(IMAGE)

    SummarizeManager.process_next()

    tasks = SummarizeManager.get_tasks(IMAGE)
    assert [task.state for task in tasks] == ["FAILED"]
    assert tasks[0].result == "Nothing to summarize: run OCR first."

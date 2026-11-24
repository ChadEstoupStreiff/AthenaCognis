from typing import Dict, List

import pytest

from views import files

ALL_SETTINGS_ON: Dict[str, bool] = {
    "enable_auto_summary": True,
    "enable_auto_ocr": True,
    "enable_auto_transcription": True,
    "enable_auto_preview": True,
}
NOTE_PATH = "/shared/2026-11-24/notes/10-00-00.md"


@pytest.fixture
def queued(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    """
    Enable every auto job and record the files queued per manager

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Dict[str, List[str]]: queued files per manager name
    """
    records: Dict[str, List[str]] = {}
    monkeypatch.setattr(files, "get_setting", ALL_SETTINGS_ON.__getitem__)
    for manager in (
        files.OCRManager,
        files.TranscriptionManager,
        files.SummarizeManager,
        files.PreviewManager,
    ):
        bucket = records.setdefault(manager.__name__, [])
        monkeypatch.setattr(manager, "add_file_to_queue", bucket.append)
    return records


def test_new_file_is_summarized(queued: Dict[str, List[str]]) -> None:
    """
    Queue the summary of an uploaded Markdown file

    Args:
        queued (Dict[str, List[str]]): queued files per manager
    Returns:
        None
    """
    files.queue_new_file_jobs(NOTE_PATH)

    assert queued["SummarizeManager"] == [NOTE_PATH]


def test_blank_note_skips_summary(queued: Dict[str, List[str]]) -> None:
    """
    Skip the summary of a note created blank from the UI

    Args:
        queued (Dict[str, List[str]]): queued files per manager
    Returns:
        None
    """
    files.queue_new_file_jobs(NOTE_PATH, summarize=False)

    assert queued["SummarizeManager"] == []
    assert queued["PreviewManager"] == [NOTE_PATH]


def test_image_gets_ocr_and_summary(queued: Dict[str, List[str]]) -> None:
    """
    Queue OCR then summary for an uploaded image

    Args:
        queued (Dict[str, List[str]]): queued files per manager
    Returns:
        None
    """
    image_path = "/shared/2026-11-24/photos/a.png"
    files.queue_new_file_jobs(image_path)

    assert queued["OCRManager"] == [image_path]
    assert queued["SummarizeManager"] == [image_path]

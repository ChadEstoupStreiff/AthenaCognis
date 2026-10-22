import os
from pathlib import Path
from typing import Dict, Iterator, List, Optional

import pytest
from whoosh.fields import Schema
from whoosh.index import FileIndex
from whoosh.index import create_in as whoosh_create_in

from controllers import FileManager as file_manager_module
from controllers.FileManager import FileManager, SearchEvent

FILES = [
    "/shared/2026-01-03/uploads/unet-segmentation.pdf",
    "/shared/2026-01-02/uploads/brain mri scan.png",
    "/shared/2026-01-01/notes/meeting.md",
]
KEYWORDS: Dict[str, List[str]] = {FILES[2]: ["brain", "segmentation"]}
SEARCH_LIMIT = 10
INDEX_FOLDER = "/data/index"


class FakeSummaries:
    @staticmethod
    def get(file: str) -> Optional[Dict[str, List[str]]]:
        """
        Return canned keywords of a file

        Args:
            file (str): file path
        Returns:
            Optional[Dict[str, List[str]]]: keywords, None when unknown
        """
        return {"keywords": KEYWORDS[file]} if file in KEYWORDS else None


class FakeNotes:
    @staticmethod
    def get(file: str) -> None:
        """
        Return no note

        Args:
            file (str): file path
        Returns:
            None: no note
        """
        return None


@pytest.fixture
def search_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """
    Stub file listing, summaries and notes, and build the Whoosh index in a temp folder

    Args:
        tmp_path (Path): temp folder
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Iterator[None]: nothing
    """

    def create_in_tmp(_folder: str, schema: Schema) -> FileIndex:
        """
        Create the index in the temp folder

        Args:
            _folder (str): ignored target folder
            schema (Schema): index schema
        Returns:
            FileIndex: index
        """
        return whoosh_create_in(str(tmp_path), schema)

    monkeypatch.setattr(file_manager_module, "SummarizeManager", FakeSummaries)
    monkeypatch.setattr(file_manager_module, "NoteManager", FakeNotes)
    monkeypatch.setattr(file_manager_module, "get_setting", lambda _key: SEARCH_LIMIT)
    monkeypatch.setattr(file_manager_module, "create_in", create_in_tmp)
    real_makedirs = os.makedirs
    monkeypatch.setattr(
        os,
        "makedirs",
        lambda path, *args, **kwargs: (
            None if path == INDEX_FOLDER else real_makedirs(path, *args, **kwargs)
        ),
    )
    monkeypatch.setattr(
        FileManager, "list_files", classmethod(lambda _cls, **_kwargs: list(FILES))
    )
    FileManager.setup()
    yield
    FileManager.ix = None


def results(events: Iterator[SearchEvent]) -> List[str]:
    """
    Keep the result paths of a search event stream

    Args:
        events (Iterator[SearchEvent]): search events
    Returns:
        List[str]: result paths, in order
    """
    return [str(event["path"]) for event in events if event["type"] == "result"]


@pytest.mark.usefixtures("search_index")
def test_contains_matches_whole_phrase_not_any_word() -> None:
    """
    Match only files containing the whole normalized phrase, not any word

    Returns:
        None: nothing
    """
    assert results(FileManager.stream_search(text="UNet brain", engine="contains")) == []
    found = results(FileManager.stream_search(text="brain MRI", engine="contains"))
    assert found == [FILES[1]]


@pytest.mark.usefixtures("search_index")
def test_contains_exact_matches_whole_phrase() -> None:
    """
    Match only files containing the whole phrase in exact mode

    Returns:
        None: nothing
    """
    found = results(
        FileManager.stream_search(text="Brain MRI", engine="contains", exact=True)
    )
    assert found == [FILES[1]]


@pytest.mark.usefixtures("search_index")
def test_fuzzy_ranks_ngram_matches() -> None:
    """
    Return Whoosh n-gram matches and report indexing progress

    Returns:
        None: nothing
    """
    events = list(FileManager.stream_search(text="segmentation", engine="fuzzy"))
    assert [event["current"] for event in events if event["type"] == "progress"] == [
        1,
        2,
        3,
    ]
    assert sorted(results(iter(events))) == sorted([FILES[0], FILES[2]])


@pytest.mark.usefixtures("search_index")
def test_fuzzy_without_text_lists_every_file() -> None:
    """
    List every file when the fuzzy engine gets no text

    Returns:
        None: nothing
    """
    assert results(FileManager.stream_search(text="  ", engine="fuzzy")) == FILES

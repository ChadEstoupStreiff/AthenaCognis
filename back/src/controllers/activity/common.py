"""Helpers shared by the AthenaCognis data sources: DB session, library files, text."""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TypeVar, cast
from urllib.parse import quote

from sqlalchemy import Column, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from db import (
    OCR,
    DocumentTree,
    ProjectFile,
    StockPile,
    Summary,
    Tag,
    TagFile,
    Transcription,
    get_db,
)

ValueT = TypeVar("ValueT")

LIBRARY_ROOT = Path("/shared")
EXCERPT_CHARS = 300
DATE_FORMAT = "%Y-%m-%d"
# /shared/<date>/<folder>/<name>
PATH_PARTS = 5


@contextmanager
def session_scope() -> Iterator[Session]:
    """
    Open a read session and close it afterwards

    Returns:
        Iterator[Session]: session
    """
    session = get_db()
    try:
        yield session
    finally:
        session.close()


def excerpt(text: str | None, limit: int = EXCERPT_CHARS) -> str:
    """
    Shorten text to one line of at most `limit` characters

    Args:
        text (str | None): text
        limit (int): maximum length
    Returns:
        str: single-line excerpt, "…" when cut
    """
    flat = " ".join((text or "").split())
    return flat if len(flat) <= limit else f"{flat[: limit - 1]}…"


@dataclass(frozen=True)
class SharedFile:
    """Library file `/shared/<date>/<folder>/<name>`."""

    path: str
    day: str
    folder: str
    name: str

    @property
    def link(self) -> str:
        """
        In-app viewer route of the file

        Returns:
            str: "/f/<date>/<folder>/<name>"
        """
        return (
            f"/f/{self.day}/{quote(self.folder, safe='')}/{quote(self.name, safe='')}"
        )


def parse_shared(path: str) -> SharedFile | None:
    """
    Split a library path

    Args:
        path (str): "/shared/<date>/<folder>/<name>"
    Returns:
        SharedFile | None: parts, None when the path has another shape
    """
    parts = path.split("/")
    if len(parts) != PATH_PARTS or parts[1] != LIBRARY_ROOT.name:
        return None
    return SharedFile(path, parts[2], parts[3], parts[4])


def days_of(start: datetime, end: datetime) -> list[str]:
    """
    List the upload-folder names (YYYY-MM-DD) touching a window

    Args:
        start (datetime): window start
        end (datetime): window end, excluded
    Returns:
        list[str]: day names, one day of margin on each side (folders are local days)
    """
    first = start.date() - timedelta(days=1)
    count = (end.date() - first).days + 1
    return [
        (first + timedelta(days=offset)).strftime(DATE_FORMAT)
        for offset in range(count)
    ]


def upload_time(file: Path, day: str) -> datetime:
    """
    Upload moment of a file: its modification time when on its folder day, else the day

    Args:
        file (Path): file on disk
        day (str): upload folder name (YYYY-MM-DD)
    Returns:
        datetime: naive UTC moment
    """
    folder_day = datetime.strptime(day, DATE_FORMAT)
    modified = datetime.fromtimestamp(file.stat().st_mtime, UTC).replace(tzinfo=None)
    return modified if abs(modified - folder_day) < timedelta(days=2) else folder_day


def uploaded_files(
    root: Path, days: Sequence[str]
) -> list[tuple[SharedFile, datetime]]:
    """
    List the files uploaded on the given days

    Args:
        root (Path): library root on disk
        days (Sequence[str]): upload folder names
    Returns:
        list[tuple[SharedFile, datetime]]: files with their upload moment
    """
    found: list[tuple[SharedFile, datetime]] = []
    for day in days:
        day_dir = root / day
        if not day_dir.is_dir():
            continue
        for file in sorted(day_dir.glob("*/*")):
            if file.is_file() and not file.name.startswith("."):
                path = f"/{LIBRARY_ROOT.name}/{day}/{file.parent.name}/{file.name}"
                found.append(
                    (
                        SharedFile(path, day, file.parent.name, file.name),
                        upload_time(file, day),
                    )
                )
    return found


def library_folders(root: Path) -> list[str]:
    """
    List the folder names used under the upload days

    Args:
        root (Path): library root on disk
    Returns:
        list[str]: sorted unique folder names
    """
    if not root.is_dir():
        return []
    return sorted({folder.name for folder in root.glob("*/*") if folder.is_dir()})


def typed_column(column: object, value_type: type[ValueT]) -> ColumnElement[ValueT]:
    """
    Give a legacy `Column(...)` model attribute its SQL value type (static typing only)

    Args:
        column (object): model attribute declared without Mapped[...]
        value_type (type[ValueT]): Python type of its values
    Returns:
        ColumnElement[ValueT]: same column, typed
    """
    del value_type
    return cast("ColumnElement[ValueT]", column)


def column_values(session: Session, column: "Column[str]") -> list[str]:
    """
    List the distinct values of a text column, sorted

    Args:
        session (Session): session
        column (Column[str]): column (e.g. Project.name)
    Returns:
        list[str]: values
    """
    return sorted({str(value) for value in session.scalars(select(column))})


def tag_names(session: Session) -> list[str]:
    """
    List every tag name

    Args:
        session (Session): session
    Returns:
        list[str]: sorted names
    """
    return sorted(session.scalars(select(Tag.name)))


def names_by_file(
    session: Session,
    files: Sequence[str],
    file_column: ColumnElement[str],
    name_column: ColumnElement[str],
) -> dict[str, set[str]]:
    """
    Map files to the names linked to them (tags, projects…)

    Args:
        session (Session): session
        files (Sequence[str]): file paths
        file_column (ColumnElement[str]): link table file column
        name_column (ColumnElement[str]): link table name column
    Returns:
        dict[str, set[str]]: names per file (files without links absent)
    """
    names: dict[str, set[str]] = {}
    if not files:
        return names
    for file, name in session.execute(
        select(file_column, name_column).where(file_column.in_(files))
    ):
        names.setdefault(file, set()).add(name)
    return names


def tags_by_file(session: Session, files: Sequence[str]) -> dict[str, set[str]]:
    """
    Map files to their tags

    Args:
        session (Session): session
        files (Sequence[str]): file paths
    Returns:
        dict[str, set[str]]: tags per file (files without tags absent)
    """
    return names_by_file(
        session, files, typed_column(TagFile.file, str), typed_column(TagFile.tag, str)
    )


def projects_by_file(session: Session, files: Sequence[str]) -> dict[str, set[str]]:
    """
    Map files to their projects

    Args:
        session (Session): session
        files (Sequence[str]): file paths
    Returns:
        dict[str, set[str]]: projects per file (files without project absent)
    """
    return names_by_file(
        session,
        files,
        typed_column(ProjectFile.file, str),
        typed_column(ProjectFile.project, str),
    )


@dataclass(frozen=True)
class ProcessedFile:
    """Result of a library job (summary, transcription, OCR, tree) on one file."""

    file: str
    kind: str
    occurred_at: datetime
    text: str
    keywords: str = ""


def _summaries(
    session: Session, window: tuple[datetime, datetime]
) -> list[ProcessedFile]:
    """
    Summaries written in a window

    Args:
        session (Session): session
        window (tuple[datetime, datetime]): start, end (excluded)
    Returns:
        list[ProcessedFile]: results
    """
    rows = session.scalars(
        select(Summary).where(Summary.date >= window[0], Summary.date < window[1])
    )
    return [
        ProcessedFile(row.file, "summary", row.date, row.summary, row.keywords)
        for row in rows
    ]


def _transcriptions(
    session: Session, window: tuple[datetime, datetime]
) -> list[ProcessedFile]:
    """
    Transcriptions written in a window

    Args:
        session (Session): session
        window (tuple[datetime, datetime]): start, end (excluded)
    Returns:
        list[ProcessedFile]: results
    """
    statement = select(Transcription).where(
        Transcription.date >= window[0], Transcription.date < window[1]
    )
    return [
        ProcessedFile(row.file, "transcription", row.date, row.transcription)
        for row in session.scalars(statement)
    ]


def _ocrs(session: Session, window: tuple[datetime, datetime]) -> list[ProcessedFile]:
    """
    Text extractions written in a window

    Args:
        session (Session): session
        window (tuple[datetime, datetime]): start, end (excluded)
    Returns:
        list[ProcessedFile]: results
    """
    rows = session.scalars(
        select(OCR).where(OCR.date >= window[0], OCR.date < window[1])
    )
    return [ProcessedFile(row.file, "ocr", row.date, row.ocr) for row in rows]


def _trees(session: Session, window: tuple[datetime, datetime]) -> list[ProcessedFile]:
    """
    Document trees built in a window

    Args:
        session (Session): session
        window (tuple[datetime, datetime]): start, end (excluded)
    Returns:
        list[ProcessedFile]: results
    """
    statement = select(DocumentTree).where(
        DocumentTree.date >= window[0], DocumentTree.date < window[1]
    )
    return [
        ProcessedFile(row.file, "tree", row.date, f"{row.block_count} blocks")
        for row in session.scalars(statement)
    ]


PROCESSED_READERS = {
    "summary": _summaries,
    "transcription": _transcriptions,
    "ocr": _ocrs,
    "tree": _trees,
}


def processed_files(
    session: Session, window: tuple[datetime, datetime], kinds: Sequence[str]
) -> list[ProcessedFile]:
    """
    Job results of the requested kinds written in a window

    Args:
        session (Session): session
        window (tuple[datetime, datetime]): start, end (excluded)
        kinds (Sequence[str]): PROCESSED_READERS keys
    Returns:
        list[ProcessedFile]: results
    """
    return [
        item
        for kind in kinds
        if kind in PROCESSED_READERS
        for item in PROCESSED_READERS[kind](session, window)
    ]


RESEARCH_TAG_KEY = "sota_tag"


def research_files(session: Session) -> set[str]:
    """
    Files tagged as research papers (tag chosen in Research)

    Args:
        session (Session): session
    Returns:
        set[str]: file paths, empty when no research tag is set
    """
    tag = session.scalar(
        select(StockPile.value).where(StockPile.key == RESEARCH_TAG_KEY)
    )
    if not tag:
        return set()
    return set(session.scalars(select(TagFile.file).where(TagFile.tag == tag)))

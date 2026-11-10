"""Anonymous usage counters for the opt-in telemetry: numbers only, never names or content."""

from dataclasses import dataclass
from typing import Optional, Type

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import (
    OCR,
    Base,
    ChatMessage,
    ChatSession,
    Embedding,
    KanbanColumn,
    Note,
    PinnedFile,
    StockPile,
    TagFile,
    TaskDependency,
    Transcription,
)

SOTA_TAG_KEY = "sota_tag"
SOTA_INFO_PREFIX = "sota_info_"
SOTA_REFS_PREFIX = "sota_refs_"
USER_ROLE = "user"


@dataclass(frozen=True)
class UsageStats:
    """Feature usage counters of one instance."""

    nbr_notes: int
    nbr_pinned_files: int
    nbr_ocr: int
    nbr_transcriptions: int
    nbr_embeddings: int
    nbr_chat_sessions: int
    nbr_chat_messages: int
    nbr_kanban_columns: int
    nbr_task_dependencies: int
    nbr_sota_papers: int
    nbr_sota_with_metadata: int
    nbr_sota_with_references: int


def count_rows(db: Session, model: Type[Base]) -> int:
    """
    Count the rows of a table

    Args:
        db (Session): database session
        model (Type[Base]): table model
    Returns:
        int: row count
    """
    return int(db.query(func.count()).select_from(model).scalar() or 0)


def count_stockpile_prefix(db: Session, prefix: str) -> int:
    """
    Count the stockpile keys starting with a prefix

    Args:
        db (Session): database session
        prefix (str): key prefix
    Returns:
        int: key count
    """
    query = db.query(func.count(StockPile.key)).filter(StockPile.key.startswith(prefix))
    return int(query.scalar() or 0)


def count_sota_papers(db: Session) -> int:
    """
    Count the files carrying the state-of-the-art tag (0 when no tag is chosen)

    Args:
        db (Session): database session
    Returns:
        int: paper count
    """
    tag: Optional[StockPile] = (
        db.query(StockPile).filter(StockPile.key == SOTA_TAG_KEY).first()
    )
    if tag is None or tag.value == "":
        return 0
    query = db.query(func.count(TagFile.file)).filter(TagFile.tag == tag.value)
    return int(query.scalar() or 0)


def count_user_messages(db: Session) -> int:
    """
    Count the chat messages written by the user

    Args:
        db (Session): database session
    Returns:
        int: message count
    """
    query = (
        db.query(func.count())
        .select_from(ChatMessage)
        .filter(ChatMessage.user == USER_ROLE)
    )
    return int(query.scalar() or 0)


def collect_usage(db: Session) -> UsageStats:
    """
    Collect the anonymous feature usage counters

    Args:
        db (Session): database session
    Returns:
        UsageStats: counters
    """
    return UsageStats(
        nbr_notes=count_rows(db, Note),
        nbr_pinned_files=count_rows(db, PinnedFile),
        nbr_ocr=count_rows(db, OCR),
        nbr_transcriptions=count_rows(db, Transcription),
        nbr_embeddings=count_rows(db, Embedding),
        nbr_chat_sessions=count_rows(db, ChatSession),
        nbr_chat_messages=count_user_messages(db),
        nbr_kanban_columns=count_rows(db, KanbanColumn),
        nbr_task_dependencies=count_rows(db, TaskDependency),
        nbr_sota_papers=count_sota_papers(db),
        nbr_sota_with_metadata=count_stockpile_prefix(db, SOTA_INFO_PREFIX),
        nbr_sota_with_references=count_stockpile_prefix(db, SOTA_REFS_PREFIX),
    )

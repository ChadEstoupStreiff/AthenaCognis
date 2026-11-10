from datetime import datetime
from typing import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from controllers.UsageStats import UsageStats, collect_usage
from db.models import Base, ChatMessage, ChatSession, Note, StockPile, Tag, TagFile

NOW = datetime(2026, 11, 10, 12, 0, 0)


@pytest.fixture
def db() -> Iterator[Session]:
    """
    Open a session on an empty in-memory SQLite database

    Returns:
        Iterator[Session]: session
    """
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def test_empty_database_counts_zero(db: Session) -> None:
    """
    Report zero everywhere on a fresh install

    Args:
        db (Session): session
    """
    stats = collect_usage(db)
    assert stats == UsageStats(
        **{field: 0 for field in UsageStats.__dataclass_fields__}
    )


def test_sota_papers_need_the_chosen_tag(db: Session) -> None:
    """
    Count tagged papers only once a SOTA tag is chosen, plus their metadata keys

    Args:
        db (Session): session
    """
    db.add_all([Tag(name="Paper", color="#000"), Tag(name="Other", color="#111")])
    db.add_all(
        [
            TagFile(file="/a.pdf", tag="Paper"),
            TagFile(file="/b.pdf", tag="Paper"),
            TagFile(file="/c.pdf", tag="Other"),
            StockPile(key="sota_info_/a.pdf", value="{}"),
            StockPile(key="sota_refs_/a.pdf", value="[]"),
            StockPile(key="sota_info_/b.pdf", value="{}"),
        ]
    )
    db.commit()
    assert collect_usage(db).nbr_sota_papers == 0

    db.add(StockPile(key="sota_tag", value="Paper"))
    db.commit()
    stats = collect_usage(db)
    assert stats.nbr_sota_papers == 2
    assert stats.nbr_sota_with_metadata == 2
    assert stats.nbr_sota_with_references == 1


def test_counts_notes_and_user_chat_messages(db: Session) -> None:
    """
    Count notes, chat sessions and the messages the user wrote

    Args:
        db (Session): session
    """
    session = ChatSession(title="t", date=NOW)
    db.add_all([Note(file="/n.md", date=NOW, note="secret"), session])
    db.flush()
    db.add_all(
        [
            ChatMessage(session_id=session.id, date=NOW, user="user", content="hi"),
            ChatMessage(
                session_id=session.id, date=NOW, user="assistant", content="hello"
            ),
        ]
    )
    db.commit()
    stats = collect_usage(db)
    assert (stats.nbr_notes, stats.nbr_chat_sessions, stats.nbr_chat_messages) == (
        1,
        1,
        1,
    )

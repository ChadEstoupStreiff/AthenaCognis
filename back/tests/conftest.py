import queue
from typing import Callable, Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from controllers.JobManager import JobManager
from db.models import Base

SessionFactory = Callable[[], Session]


@pytest.fixture
def session_factory(monkeypatch: pytest.MonkeyPatch) -> Iterator[SessionFactory]:
    """
    Point every get_db used by the job managers to an in-memory SQLite database

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Iterator[SessionFactory]: session factory of the test database
    """
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory: SessionFactory = sessionmaker(bind=engine)
    for module in (
        "controllers.JobManager",
        "controllers.OCRManager",
        "controllers.TranscriptionManager",
        "controllers.SummarizeManager",
    ):
        monkeypatch.setattr(f"{module}.get_db", factory)
    yield factory
    engine.dispose()


@pytest.fixture(autouse=True)
def fresh_queues() -> None:
    """
    Empty the in-memory queue of every job manager before each test

    Returns:
        None
    """
    pending = list(JobManager.__subclasses__())
    while pending:
        manager = pending.pop()
        manager.queue = queue.Queue()
        manager.in_progress_file = None
        pending.extend(manager.__subclasses__())

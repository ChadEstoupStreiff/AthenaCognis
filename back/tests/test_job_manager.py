from datetime import datetime, timedelta
from typing import Callable, List, Optional

import pytest
from conftest import SessionFactory
from sqlalchemy.orm import Session

from controllers.JobManager import JobAlreadyQueuedError, JobManager
from db.models import PreviewTask, TaskStateEnum

FILE = "/shared/2026-10-15/uploads/report.pdf"
NEW_FILE = "/shared/2026-10-15/archive/report.pdf"
OLD_RUN_RESULT = "old result"
RESULT = "done"
ERROR_MESSAGE = "boom"


class FakeManager(JobManager):
    """Job manager whose processing is set by each test."""

    name = "FAKE"
    task_model = PreviewTask
    behaviour: Callable[[str], str] = staticmethod(lambda file: RESULT)

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Run the behaviour set by the test

        Args:
            file (str): file path
            db (Session): session
        Returns:
            str: behaviour result
        """
        return cls.behaviour(file)


def fail(file: str) -> str:
    """
    Raise like a crashing job

    Args:
        file (str): file path
    Returns:
        str: never returns
    Raises:
        RuntimeError: always
    """
    raise RuntimeError(ERROR_MESSAGE)


def states(session_factory: SessionFactory, file: str) -> List[TaskStateEnum]:
    """
    List the task states of a file, oldest first

    Args:
        session_factory (SessionFactory): test sessions
        file (str): file path
    Returns:
        List[TaskStateEnum]: states
    """
    with session_factory() as db:
        tasks = db.query(PreviewTask).filter(PreviewTask.file == file).order_by(PreviewTask.added).all()
        return [task.state for task in tasks]


def add_task(
    session_factory: SessionFactory,
    state: TaskStateEnum,
    added: datetime,
    result: Optional[str] = None,
) -> None:
    """
    Insert a task row directly

    Args:
        session_factory (SessionFactory): test sessions
        state (TaskStateEnum): task state
        added (datetime): task date
        result (Optional[str]): task result
    Returns:
        None
    """
    with session_factory() as db:
        db.add(PreviewTask(file=FILE, added=added, state=state, result=result))
        db.commit()


@pytest.fixture(autouse=True)
def default_behaviour(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Make the fake job succeed unless a test overrides it

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    monkeypatch.setattr(FakeManager, "behaviour", staticmethod(lambda file: RESULT))


def test_success_completes_task(session_factory: SessionFactory) -> None:
    """
    Check a successful job completes its task

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    FakeManager.add_file_to_queue(FILE)

    FakeManager.process_next()

    tasks = FakeManager.get_tasks(FILE)
    assert [(task.state, task.result) for task in tasks] == [("COMPLETED", RESULT)]
    assert FakeManager.in_progress_file is None


def test_failure_marks_the_claimed_run_not_an_older_one(
    session_factory: SessionFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Check a crash fails the run being processed, not an older run of the file

    Args:
        session_factory (SessionFactory): fixture
        monkeypatch (pytest.MonkeyPatch): fixture
    Returns:
        None
    """
    add_task(session_factory, TaskStateEnum.COMPLETED, datetime.now() - timedelta(days=1), OLD_RUN_RESULT)
    monkeypatch.setattr(FakeManager, "behaviour", staticmethod(fail))
    FakeManager.add_file_to_queue(FILE)

    FakeManager.process_next()

    assert states(session_factory, FILE) == [TaskStateEnum.COMPLETED, TaskStateEnum.FAILED]
    assert FakeManager.get_tasks(FILE)[0].result == ERROR_MESSAGE
    assert not FakeManager.has_open_task(FILE)


def test_queued_file_without_pending_task_is_skipped(session_factory: SessionFactory) -> None:
    """
    Check a queued file without pending task (deleted/moved) is skipped

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    FakeManager.queue.put(FILE)

    FakeManager.process_next()

    assert states(session_factory, FILE) == []


def test_crash_outside_the_job_keeps_the_daemon_alive(
    session_factory: SessionFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Check an unexpected error is logged instead of killing the daemon

    Args:
        session_factory (SessionFactory): fixture
        monkeypatch (pytest.MonkeyPatch): fixture
    Returns:
        None
    """
    monkeypatch.setattr(FakeManager, "is_waiting", classmethod(lambda cls, file: fail(file)))
    FakeManager.queue.put(FILE)

    FakeManager.process_next()

    assert FakeManager.in_progress_file is None


def test_duplicate_request_is_rejected(session_factory: SessionFactory) -> None:
    """
    Check a file can't be queued twice

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    FakeManager.add_file_to_queue(FILE)

    with pytest.raises(JobAlreadyQueuedError):
        FakeManager.add_file_to_queue(FILE)


def test_move_requeues_open_task_under_new_path(session_factory: SessionFactory) -> None:
    """
    Check moving a queued file runs its task under the new path

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    FakeManager.add_file_to_queue(FILE)

    FakeManager.move(FILE, NEW_FILE)
    FakeManager.process_next()
    FakeManager.process_next()

    assert states(session_factory, FILE) == []
    assert states(session_factory, NEW_FILE) == [TaskStateEnum.COMPLETED]


def test_restart_requeues_interrupted_tasks_once(session_factory: SessionFactory) -> None:
    """
    Check a restart resets interrupted tasks and queues each file once

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    now = datetime.now()
    add_task(session_factory, TaskStateEnum.IN_PROGRESS, now - timedelta(minutes=1))
    add_task(session_factory, TaskStateEnum.PENDING, now)

    FakeManager.requeue_open_tasks()

    assert states(session_factory, FILE) == [TaskStateEnum.PENDING, TaskStateEnum.PENDING]
    assert FakeManager.queue.qsize() == 1


def test_delete_removes_tasks(session_factory: SessionFactory) -> None:
    """
    Check deleting a queued file drops its task

    Args:
        session_factory (SessionFactory): fixture
    Returns:
        None
    """
    FakeManager.add_file_to_queue(FILE)

    FakeManager.delete(FILE)
    FakeManager.process_next()

    assert states(session_factory, FILE) == []

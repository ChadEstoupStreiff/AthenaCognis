import logging
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, ClassVar, List, Optional, Tuple, Type

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from db import JobTask, TaskStateEnum, get_db

logger = logging.getLogger(__name__)

STARTUP_DELAY_SECONDS = 10
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
OPEN_STATES = (TaskStateEnum.PENDING, TaskStateEnum.IN_PROGRESS)
PYTHON_EXECUTABLE = "python3"

FinishListener = Callable[[str], None]


class JobAlreadyQueuedError(Exception):
    """Raised when a file already has a pending or running task."""


@dataclass(frozen=True)
class JobTaskInfo:
    """Serializable view of one task run."""

    file: str
    state: str
    added: str
    completed: Optional[str]
    result: Optional[str]


def to_info(task: JobTask) -> JobTaskInfo:
    """
    Convert a task row to its serializable view

    Args:
        task (JobTask): task row
    Returns:
        JobTaskInfo: serializable task
    """
    return JobTaskInfo(
        file=task.file,
        state=task.state.value,
        added=task.added.strftime(DATE_FORMAT),
        completed=task.completed.strftime(DATE_FORMAT) if task.completed else None,
        result=task.result,
    )


def run_python_script(script: Path, *args: str) -> str:
    """
    Run a Python script in a subprocess and return its stripped stdout

    Args:
        script (Path): script to run
        *args (str): script arguments
    Returns:
        str: stripped standard output
    Raises:
        RuntimeError: when the script exits with a non-zero code
    """
    process = subprocess.run(
        [PYTHON_EXECUTABLE, str(script), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(
            f"{script.name} failed with code {process.returncode}: {process.stderr.strip()}"
        )
    return process.stdout.strip()


class JobManager:
    """Daemon running one job kind on queued files, one at a time, tasks persisted in DB."""

    name: ClassVar[str] = "JOB"
    task_model: ClassVar[Type[JobTask]]
    queue: ClassVar["queue.Queue[str]"]
    listeners: ClassVar[List[FinishListener]]
    thread: ClassVar[Optional[threading.Thread]]
    in_progress_file: ClassVar[Optional[str]]

    def __init_subclass__(cls) -> None:
        """
        Give each job kind its own queue, listeners and thread state

        Returns:
            None
        """
        super().__init_subclass__()
        cls.queue = queue.Queue()
        cls.listeners = []
        cls.thread = None
        cls.in_progress_file = None

    # MARK: Job hooks

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Run the job on a file and add its result rows to the session

        Args:
            file (str): file path
            db (Session): session committed with the task completion
        Returns:
            str: text stored as the task result
        Raises:
            NotImplementedError: when the subclass does not override it
        """
        raise NotImplementedError

    @classmethod
    def is_waiting(cls, file: str) -> bool:
        """
        Tell whether the job must wait for another job on the same file

        Args:
            file (str): file path
        Returns:
            bool: True to leave the task pending until a listener re-queues it
        """
        return False

    @classmethod
    def delete_results(cls, db: Session, file: str) -> None:
        """
        Delete the result rows of a file

        Args:
            db (Session): session
            file (str): file path
        Returns:
            None
        """

    @classmethod
    def move_results(cls, db: Session, file: str, new_file: str) -> None:
        """
        Re-point the result rows of a file to its new path

        Args:
            db (Session): session
            file (str): old file path
            new_file (str): new file path
        Returns:
            None
        """

    # MARK: Daemon

    @classmethod
    def start(cls) -> None:
        """
        Start the daemon thread

        Returns:
            None
        """
        cls.thread = threading.Thread(target=cls.run, name=cls.name, daemon=True)
        cls.thread.start()

    @classmethod
    def is_alive(cls) -> bool:
        """
        Tell whether the daemon thread runs

        Returns:
            bool: True when the thread is alive
        """
        return cls.thread is not None and cls.thread.is_alive()

    @classmethod
    def run(cls) -> None:
        """
        Re-queue interrupted tasks, then process the queue forever

        Returns:
            None
        """
        try:
            cls.requeue_open_tasks()
        except SQLAlchemyError:
            logger.exception(f"{cls.name} >> Could not re-queue interrupted tasks")
        time.sleep(STARTUP_DELAY_SECONDS)
        while True:
            cls.process_next()

    @classmethod
    def requeue_open_tasks(cls) -> None:
        """
        Reset tasks left pending or running by a restart and queue them again

        Returns:
            None
        """
        with get_db() as db:
            tasks = (
                db.query(cls.task_model)
                .filter(cls.task_model.state.in_(OPEN_STATES))
                .all()
            )
            for task in tasks:
                task.state = TaskStateEnum.PENDING
            db.commit()
            files = list(dict.fromkeys(task.file for task in tasks))
        for file in files:
            cls.queue.put(file)
        logger.info(f"{cls.name} >> Re-queued {len(files)} interrupted task(s).")

    @classmethod
    def process_next(cls) -> None:
        """
        Process the next queued file; a crash is logged, never kills the daemon

        Returns:
            None
        """
        file = cls.queue.get()
        cls.in_progress_file = file
        try:
            cls.handle(file)
        except Exception:
            logger.exception(f"{cls.name} >> Unexpected error on {file}")
        finally:
            cls.in_progress_file = None

    @classmethod
    def handle(cls, file: str) -> None:
        """
        Claim the pending task of a file, run it and record its outcome

        Args:
            file (str): file path
        Returns:
            None
        """
        if cls.is_waiting(file):
            logger.info(f"{cls.name} >> {file} waits for another job.")
            return
        added = cls.claim(file)
        if added is None:
            logger.info(f"{cls.name} >> No pending task for {file}, skipped.")
            return
        logger.info(f"{cls.name} >> Processing {file}")
        with get_db() as db:
            try:
                result = cls.process(file, db)
            except Exception as error:
                db.rollback()
                logger.exception(f"{cls.name} >> Failed on {file}")
                cls.finish(db, (file, added), TaskStateEnum.FAILED, str(error))
            else:
                cls.finish(db, (file, added), TaskStateEnum.COMPLETED, result)
        cls.notify(file)

    @classmethod
    def claim(cls, file: str) -> Optional[datetime]:
        """
        Mark the latest pending task of a file as running

        Args:
            file (str): file path
        Returns:
            Optional[datetime]: claimed task date (task key with the file), None when no task
        """
        with get_db() as db:
            task = (
                db.query(cls.task_model)
                .filter(
                    cls.task_model.file == file,
                    cls.task_model.state == TaskStateEnum.PENDING,
                )
                .order_by(cls.task_model.added.desc())
                .first()
            )
            if task is None:
                return None
            task.state = TaskStateEnum.IN_PROGRESS
            db.commit()
            return task.added

    @classmethod
    def finish(
        cls,
        db: Session,
        key: Tuple[str, datetime],
        state: TaskStateEnum,
        result: str,
    ) -> None:
        """
        Store the outcome on the claimed task itself and commit the session

        Args:
            db (Session): session holding the job result rows
            key (Tuple[str, datetime]): claimed task key (file, added)
            state (TaskStateEnum): final state
            result (str): result text or error message
        Returns:
            None
        """
        task = db.get(cls.task_model, key)
        if task is None:
            db.rollback()
            logger.warning(f"{cls.name} >> Task {key} vanished (file moved or deleted).")
            return
        task.state = state
        task.completed = datetime.now()
        task.result = result
        db.commit()
        logger.info(f"{cls.name} >> {state.value} for {key[0]}")

    @classmethod
    def notify(cls, file: str) -> None:
        """
        Tell listeners a task of a file finished

        Args:
            file (str): file path
        Returns:
            None
        """
        for listener in cls.listeners:
            listener(file)

    # MARK: Queue

    @classmethod
    def add_file_to_queue(cls, file: str) -> None:
        """
        Create a pending task for a file and queue it

        Args:
            file (str): file path
        Returns:
            None
        Raises:
            JobAlreadyQueuedError: when the file already has an open task
        """
        with get_db() as db:
            if cls.open_task_exists(db, file):
                raise JobAlreadyQueuedError(f"{file} is already in the {cls.name} queue.")
            db.add(
                cls.task_model(
                    file=file, added=datetime.now(), state=TaskStateEnum.PENDING
                )
            )
            db.commit()
        cls.queue.put(file)

    @classmethod
    def open_task_exists(cls, db: Session, file: str) -> bool:
        """
        Tell whether a file has a pending or running task

        Args:
            db (Session): session
            file (str): file path
        Returns:
            bool: True when an open task exists
        """
        return (
            db.query(cls.task_model)
            .filter(
                cls.task_model.file == file, cls.task_model.state.in_(OPEN_STATES)
            )
            .first()
            is not None
        )

    @classmethod
    def has_open_task(cls, file: str) -> bool:
        """
        Tell whether a file has a pending or running task

        Args:
            file (str): file path
        Returns:
            bool: True when an open task exists
        """
        with get_db() as db:
            return cls.open_task_exists(db, file)

    @classmethod
    def latest_state(cls, file: str) -> Optional[TaskStateEnum]:
        """
        Get the state of the latest task of a file

        Args:
            file (str): file path
        Returns:
            Optional[TaskStateEnum]: latest state, None when never run
        """
        with get_db() as db:
            task = (
                db.query(cls.task_model)
                .filter(cls.task_model.file == file)
                .order_by(cls.task_model.added.desc())
                .first()
            )
            return None if task is None else task.state

    # MARK: File lifecycle

    @classmethod
    def delete(cls, file: str) -> None:
        """
        Delete the tasks and results of a file

        Args:
            file (str): file path
        Returns:
            None
        Raises:
            SQLAlchemyError: when the deletion fails
        """
        with get_db() as db:
            try:
                db.query(cls.task_model).filter(cls.task_model.file == file).delete()
                cls.delete_results(db, file)
                db.commit()
            except SQLAlchemyError:
                db.rollback()
                logger.exception(f"{cls.name} >> Error deleting tasks of {file}")
                raise

    @classmethod
    def move(cls, file: str, new_file: str) -> None:
        """
        Move the tasks and results of a file, re-queuing its open task under the new path

        Args:
            file (str): old file path
            new_file (str): new file path
        Returns:
            None
        Raises:
            SQLAlchemyError: when the move fails
        """
        with get_db() as db:
            try:
                tasks = db.query(cls.task_model).filter(cls.task_model.file == file).all()
                has_open_task = any(task.state in OPEN_STATES for task in tasks)
                for task in tasks:
                    task.file = new_file
                    if task.state in OPEN_STATES:
                        task.state = TaskStateEnum.PENDING
                cls.move_results(db, file, new_file)
                db.commit()
            except SQLAlchemyError:
                db.rollback()
                logger.exception(f"{cls.name} >> Error moving tasks of {file}")
                raise
        if has_open_task:
            cls.queue.put(new_file)

    # MARK: Listing

    @classmethod
    def get_tasks(cls, file: str) -> List[JobTaskInfo]:
        """
        List the task runs of a file

        Args:
            file (str): file path
        Returns:
            List[JobTaskInfo]: runs, newest first
        """
        with get_db() as db:
            tasks = (
                db.query(cls.task_model)
                .filter(cls.task_model.file == file)
                .order_by(cls.task_model.added.desc())
                .all()
            )
            return [to_info(task) for task in tasks]

    @classmethod
    def list_tasks(cls) -> List[JobTaskInfo]:
        """
        List every task run

        Returns:
            List[JobTaskInfo]: runs, newest first
        """
        with get_db() as db:
            tasks = db.query(cls.task_model).order_by(cls.task_model.added.desc()).all()
            return [to_info(task) for task in tasks]

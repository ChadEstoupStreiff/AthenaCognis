"""Mail Preview daemon status for the Jobs page (`/mail-preview/health|running|tasks`)."""

from dataclasses import asdict

from fastapi import APIRouter
from sqlalchemy import select

from controllers.mail import store
from controllers.MailManager import MailManager
from db import MailMessage

NO_SUBJECT = "(no subject)"

router = APIRouter(prefix="/mail-preview", tags=["Mail"])

JsonDict = dict[str, object]


def subjects_of(message_ids: list[str]) -> dict[str, str]:
    """
    Subjects of messages (tasks show them instead of message ids)

    Args:
        message_ids (list[str]): message ids
    Returns:
        dict[str, str]: id → subject
    """
    if not message_ids:
        return {}
    with store.session_scope() as session:
        rows = session.execute(
            select(MailMessage.id, MailMessage.subject).where(
                MailMessage.id.in_(message_ids)
            )
        )
        return {message_id: subject or NO_SUBJECT for message_id, subject in rows}


@router.get("/health")
def health() -> str:
    """
    Mail Preview daemon health

    Returns:
        str: RUNNING when the daemon thread is alive, DEAD otherwise
    """
    return "RUNNING" if MailManager.is_alive() else "DEAD"


@router.get("/running")
def running() -> str | None:
    """
    Subject of the mail being previewed

    Returns:
        str | None: subject, None when idle
    """
    message_id = MailManager.in_progress_file
    if message_id is None:
        return None
    return subjects_of([message_id]).get(message_id, message_id)


@router.get("/tasks")
def list_tasks() -> list[JsonDict]:
    """
    Mail Preview runs, each labelled with its mail subject

    Returns:
        list[JsonDict]: tasks (`file` = message id, `label` = subject)
    """
    tasks = MailManager.list_tasks()
    labels = subjects_of(list({task.file for task in tasks}))
    return [
        {**asdict(task), "label": labels.get(task.file, "(deleted mail)")}
        for task in tasks
    ]

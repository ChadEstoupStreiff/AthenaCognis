"""Mail Preview daemon: AI title and 40-word summary of each message."""

import logging
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.JobManager import OPEN_STATES, JobAlreadyQueuedError, JobManager
from controllers.mail import store
from controllers.mail.assistant import LlmCall, write_preview
from controllers.mail.llm import ask_preview_llm
from controllers.mail.service import brief_of
from db import MailMessage, MailPreviewTask, get_db
from views.settings import get_setting

AUTO_PREVIEW_SETTING = "mail_auto_preview"
AUTO_PREVIEW_BOXES_SETTING = "mail_auto_preview_boxes"

logger = logging.getLogger(__name__)


def auto_preview_boxes() -> list[str]:
    """
    Boxes whose new mail gets a Mail Preview (unknown values dropped)

    Returns:
        list[str]: mailbox views
    """
    value = get_setting(AUTO_PREVIEW_BOXES_SETTING)
    boxes = value if isinstance(value, list) else []
    return [box for box in boxes if isinstance(box, str) and box in store.MAIL_VIEWS]


class MailManager(JobManager):
    """Generate Mail Previews one message at a time (`file` = message id)."""

    name = "MAIL"
    task_model = MailPreviewTask
    llm: Callable[[str], str] = staticmethod(ask_preview_llm)

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Write the Mail Preview of a message onto its row

        Args:
            file (str): message id
            db (Session): session committed with the task completion
        Returns:
            str: "title: summary", stored as the task result
        Raises:
            LookupError: when the message no longer exists
        """
        message = db.get(MailMessage, file)
        if message is None:
            raise LookupError(f"Mail {file} not found.")
        llm: LlmCall = cls.llm
        preview = write_preview(brief_of(message), llm)
        message.preview_title = preview.title
        message.preview_text = preview.summary
        return f"{preview.title}: {preview.summary}"

    @classmethod
    def delete_results(cls, db: Session, file: str) -> None:
        """
        Clear the Mail Preview of a message

        Args:
            db (Session): session
            file (str): message id
        """
        message = db.get(MailMessage, file)
        if message is not None:
            message.preview_title = None
            message.preview_text = None

    @classmethod
    def queue_previews(cls, message_ids: list[str]) -> int:
        """
        Queue Mail Previews (messages already queued are skipped)

        Args:
            message_ids (list[str]): message ids
        Returns:
            int: messages queued
        """
        queued = 0
        for message_id in message_ids:
            try:
                cls.add_file_to_queue(message_id)
            except JobAlreadyQueuedError:
                continue
            queued += 1
        return queued

    @classmethod
    def queue_new_mail(cls, message_ids: list[str]) -> None:
        """
        Sync hook: queue previews of new received mail in the chosen boxes
        (Settings → Mail: auto-generate on, boxes picked)

        Args:
            message_ids (list[str]): new received message ids
        """
        if not message_ids or get_setting(AUTO_PREVIEW_SETTING) is not True:
            return
        boxes = auto_preview_boxes()
        with store.session_scope() as session:
            selected = store.ids_in_views(session, message_ids, boxes)
        if selected:
            logger.info(
                "MAIL >> Queueing %d previews (%s)", len(selected), ", ".join(boxes)
            )
            cls.queue_previews(selected)

    @classmethod
    def pending_count(cls) -> int:
        """
        Count Mail Previews waiting or running

        Returns:
            int: open tasks
        """
        with get_db() as db:
            query = select(MailPreviewTask.file).where(
                MailPreviewTask.state.in_(OPEN_STATES)
            )
            return len(list(db.scalars(query)))

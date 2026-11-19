from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import views.mail_preview
from controllers import MailManager as mail_manager_module
from controllers.JobManager import JobTaskInfo
from controllers.mail import llm as llm_module
from controllers.mail import service, store
from controllers.mail.assistant import (
    PREVIEW_MAX_WORDS,
    AssistantError,
    MailBrief,
    limit_words,
    parse_preview,
    write_preview,
)
from controllers.mail.imap_client import FetchedMail
from controllers.mail.transport import FetchBatch
from controllers.MailManager import MailManager
from db import MailAccount, MailMessage
from db.models import Base

ACCOUNT_ID = "acc-1"


@pytest.fixture
def session() -> Iterator[Session]:
    """
    In-memory database holding one account and one message

    Returns:
        Iterator[Session]: session
    """
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(
        MailAccount(
            id=ACCOUNT_ID,
            label="Me",
            email="me@x.org",
            username="me",
            password="pw",
            imap_host="h",
            imap_port=993,
            smtp_host="h",
            smtp_port=465,
        )
    )
    db.add(
        MailMessage(
            id="m1",
            account_id=ACCOUNT_ID,
            folder="INBOX",
            uid=1,
            sender_email="ann@x.org",
            sender_name="Ann",
            subject="Budget meeting moved",
            date=datetime(2026, 11, 17, 9, 0),
            body_text="Hi, the budget meeting moves to Thursday 2pm. Can you confirm?",
        )
    )
    db.commit()
    yield db
    db.close()
    engine.dispose()


def test_limit_words_cuts_and_marks() -> None:
    """
    Keep at most n words, with an ellipsis when cut

    Returns:
        None
    """
    assert limit_words("a  b c", 5) == "a b c"
    assert limit_words("one two three four", 2) == "one two…"


def test_parse_preview_enforces_limits() -> None:
    """
    Cut a summary longer than PREVIEW_MAX_WORDS words

    Returns:
        None
    """
    long_summary = " ".join(f"w{index}" for index in range(PREVIEW_MAX_WORDS * 2))
    preview = parse_preview(
        f'{{"title": "Meeting moved", "summary": "{long_summary}"}}'
    )
    assert preview.title == "Meeting moved"
    assert len(preview.summary.split()) == PREVIEW_MAX_WORDS


@pytest.mark.parametrize("answer", ['{"title": "x"}', '{"summary": "y"}', "nope"])
def test_parse_preview_rejects_incomplete_answers(answer: str) -> None:
    """
    Fail when the title or summary is missing

    Args:
        answer (str): LLM answer
    Returns:
        None
    """
    with pytest.raises(AssistantError):
        parse_preview(answer)


def test_write_preview_refuses_empty_mail() -> None:
    """
    Never call the LLM for an empty message

    Returns:
        None
    """
    brief = MailBrief("a@x.org", "", datetime(2026, 1, 1), "  ")
    with pytest.raises(AssistantError):
        write_preview(brief, lambda prompt: pytest.fail("LLM called"))


def test_process_stores_the_preview(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Write title and summary onto the message; clearing removes them

    Returns:
        None
    """
    answer = (
        '{"title": "Meeting moved to Thursday", "summary": "Confirm 2pm Thursday."}'
    )
    monkeypatch.setattr(MailManager, "llm", staticmethod(lambda prompt: answer))
    result = MailManager.process("m1", session)
    message = session.get(MailMessage, "m1")
    assert message is not None
    assert (message.preview_title, message.preview_text) == (
        "Meeting moved to Thursday",
        "Confirm 2pm Thursday.",
    )
    assert result.startswith("Meeting moved")
    MailManager.delete_results(session, "m1")
    assert message.preview_title is None


def test_process_fails_for_missing_message(session: Session) -> None:
    """
    Raise when the message was deleted

    Returns:
        None
    """
    with pytest.raises(LookupError):
        MailManager.process("gone", session)


def test_auto_preview_follows_settings_and_boxes(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Queue new mail only when auto preview is on, and only from the chosen boxes

    Returns:
        None
    """
    session.add(
        MailMessage(
            id="m2",
            account_id=ACCOUNT_ID,
            folder="INBOX",
            uid=2,
            sender_email="news@shop.org",
            subject="Sale",
            category="newsletter",
            date=datetime(2026, 11, 17, 10, 0),
        )
    )
    session.commit()
    monkeypatch.setattr(store, "get_db", sessionmaker(bind=session.get_bind()))
    queued: list[list[str]] = []
    monkeypatch.setattr(MailManager, "queue_previews", lambda ids: queued.append(ids))
    settings: dict[str, object] = {"mail_auto_preview": False}
    monkeypatch.setattr(mail_manager_module, "get_setting", settings.get)

    MailManager.queue_new_mail(["m1", "m2"])
    settings.update(mail_auto_preview=True, mail_auto_preview_boxes=["inbox", "nope"])
    MailManager.queue_new_mail(["m1", "m2"])
    settings["mail_auto_preview_boxes"] = ["others"]
    MailManager.queue_new_mail(["m1", "m2"])
    settings["mail_auto_preview_boxes"] = []
    MailManager.queue_new_mail(["m1", "m2"])
    assert queued == [["m1"], ["m2"]]


def test_preview_routing_falls_back_to_mail(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Use the Mail model until a Mail Preview model is set

    Returns:
        None
    """
    settings: dict[str, object] = {}
    monkeypatch.setattr(llm_module, "get_setting", settings.get)
    assert llm_module.preview_routing_prefix() == "mail"
    settings["mail_preview_type"] = "Claude"
    assert llm_module.preview_routing_prefix() == "mail_preview"


def test_sync_hook_receives_new_inbox_ids(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Pass the ids of newly stored received mail to the hook (not sent mail)

    Returns:
        None
    """
    factory = sessionmaker(bind=session.get_bind())
    monkeypatch.setattr(store, "get_db", factory)
    seen: list[list[str]] = []
    monkeypatch.setattr(service, "NEW_MAIL_HOOK", seen.append)

    class Fake:
        """Transport returning one message per mailbox."""

        def fetch(self, mailbox: str, cursor: object, limit: int) -> FetchBatch:
            """
            Return a canned batch

            Args:
                mailbox (str): inbox or sent
                cursor (object): unused
                limit (int): unused
            Returns:
                FetchBatch: batch
            """
            raw = b"From: b@x.org\r\nSubject: Hi\r\n\r\nbody"
            return FetchBatch(mailbox, [FetchedMail(5, raw, False, False)])

    monkeypatch.setattr(service, "transport_for", lambda link: Fake())
    assert service.sync_account(ACCOUNT_ID).fetched == 2
    assert len(seen) == 1 and len(seen[0]) == 1


def test_jobs_endpoints_label_tasks_with_subjects(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Expose Mail Preview runs to the Jobs page with the mail subject as label

    Returns:
        None
    """
    monkeypatch.setattr(store, "get_db", sessionmaker(bind=session.get_bind()))
    task = JobTaskInfo("m1", "COMPLETED", "2026-11-17 09:00:00", None, "ok")
    gone = JobTaskInfo("x", "FAILED", "2026-11-17 09:00:00", None, "err")
    monkeypatch.setattr(
        MailManager, "list_tasks", classmethod(lambda cls: [task, gone])
    )
    monkeypatch.setattr(MailManager, "in_progress_file", "m1")
    app = FastAPI()
    app.include_router(views.mail_preview.router)
    client = TestClient(app)
    labels = {
        row["file"]: row["label"] for row in client.get("/mail-preview/tasks").json()
    }
    assert labels == {"m1": "Budget meeting moved", "x": "(deleted mail)"}
    assert client.get("/mail-preview/running").json() == "Budget meeting moved"
    assert client.get("/mail-preview/health").json() in ("RUNNING", "DEAD")

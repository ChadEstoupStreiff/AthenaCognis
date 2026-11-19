import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import (
    TEXT,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    false,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.mysql import MEDIUMTEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base of every table."""


class StockPile(Base):
    __tablename__ = "StockPile"

    key = Column(String(512), primary_key=True, index=True)
    value = Column(TEXT, nullable=False)


class Setting(Base):
    __tablename__ = "Setting"

    key = Column(String(64), primary_key=True, index=True)
    value = Column(TEXT, nullable=False)


class Note(Base):
    __tablename__ = "Note"

    file = Column(String(512), primary_key=True, index=True)
    date = Column(DateTime, nullable=False)
    note = Column(TEXT, nullable=False)


class TaskStateEnum(Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class JobTask(Base):
    """Run of a background job on one file (one table per job kind)."""

    __abstract__ = True

    file: Mapped[str] = mapped_column(String(512), primary_key=True, index=True)
    state: Mapped[TaskStateEnum] = mapped_column(
        SQLEnum(TaskStateEnum), nullable=False, default=TaskStateEnum.PENDING
    )
    added: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    completed: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result: Mapped[str | None] = mapped_column(TEXT, nullable=True)


class OCR(Base):
    __tablename__ = "OCR"

    file: Mapped[str] = mapped_column(String(512), primary_key=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ocr: Mapped[str] = mapped_column(TEXT, nullable=False)
    blip: Mapped[str | None] = mapped_column(TEXT, nullable=True)


class OCRTask(JobTask):
    __tablename__ = "OCRTask"


class Embedding(Base):
    __tablename__ = "Embedding"

    file = Column(String(512), primary_key=True, index=True)
    date = Column(DateTime, nullable=False)
    vector = Column(TEXT, nullable=False)  # JSON array of 384 floats


class Summary(Base):
    __tablename__ = "Summary"

    file: Mapped[str] = mapped_column(String(512), primary_key=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    summary: Mapped[str] = mapped_column(TEXT, nullable=False)
    keywords: Mapped[str] = mapped_column(TEXT, nullable=False)


class SummaryTask(JobTask):
    __tablename__ = "SummaryTask"


class DocumentTree(Base):
    """Hierarchical section tree of a document (JSON, block ranges only)."""

    # Lowercase: mixed-case names + lower_case_table_names=2 on a macOS bind mount
    # make MariaDB read a stale lowercase .frm at creation (error 1033).
    __tablename__ = "document_tree"

    file: Mapped[str] = mapped_column(String(512), primary_key=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    params: Mapped[str] = mapped_column(TEXT, nullable=False)
    block_count: Mapped[int] = mapped_column(Integer, nullable=False)
    tree: Mapped[str] = mapped_column(TEXT, nullable=False)


class DocumentTreeTask(JobTask):
    """Tree generation run; keeps the requested parameters."""

    __tablename__ = "document_tree_task"

    params: Mapped[str | None] = mapped_column(TEXT, nullable=True)


class Transcription(Base):
    __tablename__ = "Transcription"

    file: Mapped[str] = mapped_column(String(512), primary_key=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    transcription: Mapped[str] = mapped_column(TEXT, nullable=False)


class TranscriptionTask(JobTask):
    __tablename__ = "TranscriptionTask"


class Tag(Base):
    __tablename__ = "Tag"

    name = Column(String(20), primary_key=True, index=True)
    color = Column(String(32), nullable=False)


class TagFile(Base):
    __tablename__ = "TagFile"

    file = Column(String(512), primary_key=True, index=True)
    tag = mapped_column(
        ForeignKey("Tag.name", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class Project(Base):
    __tablename__ = "Project"

    name = Column(String(50), primary_key=True, nullable=False)
    description = Column(TEXT, nullable=True)
    color = Column(String(32), nullable=False)
    notes = Column(TEXT, default="")
    todo = Column(TEXT, default="[]")


class ProjectFile(Base):
    __tablename__ = "ProjectFile"

    project = mapped_column(
        ForeignKey("Project.name", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    file = Column(String(512), primary_key=True, index=True)


class CalendarRecord(Base):
    __tablename__ = "CalendarRecord"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    project = mapped_column(
        ForeignKey("Project.name", ondelete="CASCADE", onupdate="CASCADE")
    )
    date = Column(DateTime, nullable=False)
    start_time = Column(DateTime, nullable=True)
    time_spent = Column(Float, nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(TEXT, nullable=True)
    location = Column(String(512), nullable=True)
    attendees = Column(TEXT, nullable=True)


class ChatSession(Base):
    __tablename__ = "ChatSession"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    title = Column(String(512), nullable=False)
    description = Column(TEXT, nullable=True)
    date = Column(DateTime, nullable=False)


class ChatMessage(Base):
    __tablename__ = "ChatMessage"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    session_id = mapped_column(
        ForeignKey("ChatSession.id", ondelete="CASCADE", onupdate="CASCADE")
    )
    date = Column(DateTime, nullable=False)
    user = Column(String(32), nullable=False)  # e.g., 'user', 'assistant'

    files = Column(TEXT, nullable=True)
    calendar = Column(TEXT, nullable=True)
    content = Column(TEXT, nullable=False)


class Link(Base):
    __tablename__ = "Link"

    fileA = Column(String(256), primary_key=True, index=True)
    fileB = Column(String(256), primary_key=True, index=True)
    force = Column(Float, nullable=False, default=1.0)
    comment = Column(TEXT, nullable=True)


class Task(Base):
    __tablename__ = "Task"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    title = Column(String(255), nullable=False)
    description = Column(TEXT, nullable=True)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    completed = Column(DateTime, nullable=True)
    priority = Column(Float, nullable=False, default=0.0)


class TaskTag(Base):
    __tablename__ = "TaskTag"

    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    tag = mapped_column(
        ForeignKey("Tag.name", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class TaskProject(Base):
    __tablename__ = "TaskProject"

    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    project_name = mapped_column(
        ForeignKey("Project.name", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class TaskFile(Base):
    __tablename__ = "TaskFile"

    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    file = Column(String(512), primary_key=True, index=True)


class TaskCalendar(Base):
    __tablename__ = "TaskCalendar"

    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    calendar_id = mapped_column(
        ForeignKey("CalendarRecord.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class TaskDependency(Base):
    __tablename__ = "TaskDependency"

    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    depends_on_task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class KanbanBoard(Base):
    __tablename__ = "KanbanBoard"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    name = Column(String(255), nullable=False)
    description = Column(TEXT, nullable=True)


class KanbanColumn(Base):
    __tablename__ = "KanbanColumn"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    board_id = mapped_column(
        ForeignKey("KanbanBoard.id", ondelete="CASCADE", onupdate="CASCADE"),
        index=True,
    )
    name = Column(String(255), nullable=False)
    color = Column(String(32), nullable=False)
    position = Column(Float, nullable=False)


class KanbanColumnTask(Base):
    __tablename__ = "KanbanColumnTask"

    column_id = mapped_column(
        ForeignKey("KanbanColumn.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class PreviewTask(JobTask):
    __tablename__ = "PreviewTask"


class Contact(Base):
    __tablename__ = "Contact"

    id = Column(
        String(255), primary_key=True, default=lambda: str(uuid.uuid4()), index=True
    )
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(64), nullable=True)
    company = Column(String(255), nullable=True)
    role = Column(String(255), nullable=True)
    description = Column(TEXT, nullable=True)
    notes = Column(TEXT, default="")


class ContactFile(Base):
    __tablename__ = "ContactFile"

    contact_id = mapped_column(
        ForeignKey("Contact.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    file = Column(String(512), primary_key=True, index=True)


class ContactTag(Base):
    __tablename__ = "ContactTag"

    contact_id = mapped_column(
        ForeignKey("Contact.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    tag = mapped_column(
        ForeignKey("Tag.name", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class ContactProject(Base):
    __tablename__ = "ContactProject"

    contact_id = mapped_column(
        ForeignKey("Contact.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    project_name = mapped_column(
        ForeignKey("Project.name", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class TaskContact(Base):
    __tablename__ = "TaskContact"

    task_id = mapped_column(
        ForeignKey("Task.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    contact_id = mapped_column(
        ForeignKey("Contact.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class CalendarContact(Base):
    __tablename__ = "CalendarContact"

    calendar_id = mapped_column(
        ForeignKey("CalendarRecord.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )
    contact_id = mapped_column(
        ForeignKey("Contact.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
        index=True,
    )


class PinnedFile(Base):
    __tablename__ = "PinnedFile"

    file = Column(String(512), primary_key=True, index=True)


# Lowercase table names: see DocumentTree (MariaDB + macOS bind mount, error 1033).
LONG_TEXT = TEXT().with_variant(MEDIUMTEXT(), "mysql")


class MailAccount(Base):
    """Mailbox the mail client reads and sends with (IMAP/SMTP or Exchange EWS)."""

    __tablename__ = "mail_account"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    protocol: Mapped[str] = mapped_column(
        String(8), nullable=False, default="imap", server_default="imap"
    )
    color: Mapped[str] = mapped_column(
        String(7), nullable=False, default="#3b82f6", server_default="#3b82f6"
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    password: Mapped[str] = mapped_column(TEXT, nullable=False)
    imap_host: Mapped[str] = mapped_column(String(255), nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, nullable=False)
    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    signature: Mapped[str | None] = mapped_column(TEXT, nullable=True)


class MailMessage(Base):
    """One message fetched from an account folder."""

    __tablename__ = "mail_message"
    __table_args__ = (UniqueConstraint("account_id", "folder", "uid"),)

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        ForeignKey("mail_account.id", ondelete="CASCADE", onupdate="CASCADE"),
        index=True,
    )
    folder: Mapped[str] = mapped_column(String(255), nullable=False)
    uid: Mapped[int] = mapped_column(Integer, nullable=False)
    remote_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    thread_refs: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    sender_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sender_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    recipients: Mapped[str] = mapped_column(TEXT, nullable=False, default="")
    cc: Mapped[str] = mapped_column(TEXT, nullable=False, default="")
    subject: Mapped[str] = mapped_column(TEXT, nullable=False, default="")
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    snippet: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    body_text: Mapped[str] = mapped_column(LONG_TEXT, nullable=False, default="")
    body_html: Mapped[str | None] = mapped_column(LONG_TEXT, nullable=True)
    attachments: Mapped[str] = mapped_column(TEXT, nullable=False, default="[]")
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="person")
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_flagged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # Last time flagged for the Activity feed (kept in AthenaCognis only); counts
    # as flagged until the next "Activity reset time".
    activity_flagged_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    # Logical mailbox: "inbox" (received) or "sent"; folder is the server name.
    mailbox: Mapped[str] = mapped_column(
        String(8), nullable=False, default="inbox", server_default="inbox", index=True
    )
    summary: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    needs_reply: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    suggested_action: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    # Mail Preview: AI title and short summary (MailManager).
    preview_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preview_text: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    # Trash: set when deleted (hidden from every view, restorable); purged rows keep
    # only a tombstone so the sync cursor does not fetch them again.
    trashed_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    is_purged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class MailActivityFlag(Base):
    """One flag of a message for the Activity feed (history: one per activity day)."""

    __tablename__ = "mail_activity_flag"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    message_id: Mapped[str] = mapped_column(
        ForeignKey("mail_message.id", ondelete="CASCADE", onupdate="CASCADE"),
        index=True,
    )
    flagged_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class MailSender(Base):
    """How the mail client treats one sender (VIP, muted, blocked) and its contact."""

    __tablename__ = "mail_sender"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    flag: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    note: Mapped[str] = mapped_column(TEXT, nullable=False, default="")
    contact_id: Mapped[str | None] = mapped_column(
        ForeignKey("Contact.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
    )


class MailOutgoing(Base):
    """Message waiting in the Outbox until the server accepted it."""

    __tablename__ = "mail_outgoing"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        ForeignKey("mail_account.id", ondelete="CASCADE", onupdate="CASCADE"),
        index=True,
    )
    # JSON lists of bare addresses.
    recipients: Mapped[str] = mapped_column(TEXT, nullable=False, default="[]")
    cc: Mapped[str] = mapped_column(TEXT, nullable=False, default="[]")
    subject: Mapped[str] = mapped_column(TEXT, nullable=False, default="")
    # Written text only; signature and quote are added when sending.
    body: Mapped[str] = mapped_column(LONG_TEXT, nullable=False, default="")
    quote: Mapped[str] = mapped_column(LONG_TEXT, nullable=False, default="")
    # Replied message (no foreign key: the original may be deleted meanwhile).
    reply_to_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    # "queued", "sending" or "failed".
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    error: Mapped[str | None] = mapped_column(TEXT, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MailDraft(Base):
    """Message saved from the compose dialog, not sent yet (Drafts box)."""

    __tablename__ = "mail_draft"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        ForeignKey("mail_account.id", ondelete="CASCADE", onupdate="CASCADE"),
        index=True,
    )
    # "new", "reply" or "forward" (compose dialog title).
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="new")
    # JSON lists of addresses as typed (may still be incomplete).
    recipients: Mapped[str] = mapped_column(TEXT, nullable=False, default="[]")
    cc: Mapped[str] = mapped_column(TEXT, nullable=False, default="[]")
    subject: Mapped[str] = mapped_column(TEXT, nullable=False, default="")
    # Written text only; signature and quote are added when sending.
    body: Mapped[str] = mapped_column(LONG_TEXT, nullable=False, default="")
    quote: Mapped[str] = mapped_column(LONG_TEXT, nullable=False, default="")
    # Replied message (no foreign key: the original may be deleted meanwhile).
    reply_to_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    # Trash: set when deleted, removed for good after the retention period.
    trashed_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )


class MailPreviewTask(JobTask):
    """Mail Preview generation of one message (`file` holds the message id)."""

    __tablename__ = "mail_preview_task"

import uuid
from enum import Enum

from sqlalchemy import TEXT, Column, DateTime, Float, ForeignKey, String
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import declarative_base, mapped_column

Base = declarative_base()


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


class OCR(Base):
    __tablename__ = "OCR"

    file = Column(String(512), primary_key=True, index=True)
    date = Column(DateTime, nullable=False)
    ocr = Column(TEXT, nullable=False)
    blip = Column(TEXT, nullable=True)


class OCRTask(Base):
    __tablename__ = "OCRTask"

    file = Column(String(512), primary_key=True, index=True)
    state = Column(
        SQLEnum(TaskStateEnum), nullable=False, default=TaskStateEnum.PENDING
    )
    added = Column(DateTime, primary_key=True)
    completed = Column(DateTime, nullable=True)
    result = Column(TEXT, nullable=True)


class Embedding(Base):
    __tablename__ = "Embedding"

    file = Column(String(512), primary_key=True, index=True)
    date = Column(DateTime, nullable=False)
    vector = Column(TEXT, nullable=False)  # JSON array of 384 floats


class Summary(Base):
    __tablename__ = "Summary"

    file = Column(String(512), primary_key=True, index=True)
    date = Column(DateTime, nullable=False)
    summary = Column(TEXT, nullable=False)
    keywords = Column(TEXT, nullable=False)


class SummaryTask(Base):
    __tablename__ = "SummaryTask"

    file = Column(String(512), primary_key=True, index=True)
    state = Column(
        SQLEnum(TaskStateEnum), nullable=False, default=TaskStateEnum.PENDING
    )
    added = Column(DateTime, primary_key=True)
    completed = Column(DateTime, nullable=True)
    result = Column(TEXT, nullable=True)


class Transcription(Base):
    __tablename__ = "Transcription"

    file = Column(String(512), primary_key=True, index=True)
    date = Column(DateTime, nullable=False)
    transcription = Column(TEXT, nullable=False)


class TranscriptionTask(Base):
    __tablename__ = "TranscriptionTask"

    file = Column(String(512), primary_key=True, index=True)
    state = Column(
        SQLEnum(TaskStateEnum), nullable=False, default=TaskStateEnum.PENDING
    )
    added = Column(DateTime, primary_key=True)
    completed = Column(DateTime, nullable=True)
    result = Column(TEXT, nullable=True)


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


class PreviewTask(Base):
    __tablename__ = "PreviewTask"

    file = Column(String(512), primary_key=True, index=True)
    state = Column(
        SQLEnum(TaskStateEnum), nullable=False, default=TaskStateEnum.PENDING
    )
    added = Column(DateTime, primary_key=True)
    completed = Column(DateTime, nullable=True)
    result = Column(TEXT, nullable=True)


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

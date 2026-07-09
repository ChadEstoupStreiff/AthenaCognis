import logging
from db.db import DB, get_db
from db.models import (
    Setting,
    Note,
    Embedding,
    OCR,
    OCRTask,
    Summary,
    SummaryTask,
    Transcription,
    TranscriptionTask,
    TaskStateEnum,
    Project,
    ProjectFile,
    Tag,
    TagFile,
    CalendarRecord,
    StockPile,
    ChatSession,
    ChatMessage,
    Task,
    TaskTag,
    TaskProject,
    TaskFile,
    TaskCalendar,
    KanbanBoard,
    KanbanColumn,
    KanbanColumnTask,
    Link,
    PreviewTask,
    Contact,
    ContactFile,
    ContactTag,
    ContactProject,
    TaskContact,
    CalendarContact,
    PinnedFile,
)


def create_default_values():
    """
    Set up the database by creating all tables.
    """
    logging.info("Inserting default values ...")
    db = get_db()
    try:
        if db.query(Project).first() is None:
            db.add(Project(name="🌀 Other", description="Other project", color="#808080"))
            db.add(Project(name="🗣️ Meeting", description="Meeting project", color="#2ECC71"))
            db.add(Project(name="🎓 School", description="School project", color="#9B59B6"))
            db.add(Project(name="🌴 Vacation", description="Vacation project", color="#1ABC9C"))
            db.add(Project(name="🧠 Training", description="Training project", color="#E67E22"))
            db.commit()
        if db.query(Tag).first() is None:
            db.add(Tag(name="Research", color="#2ECC71"))    # green
            db.add(Tag(name="Writing", color="#E67E22"))     # orange
            db.add(Tag(name="Reading", color="#9B59B6"))     # purple
            db.add(Tag(name="Meeting", color="#1ABC9C"))     # teal
            db.add(Tag(name="Urgent", color="#E74C3C"))      # red
            db.add(Tag(name="Low Priority", color="#95A5A6"))# gray
            db.commit()
        print("Database setup complete.")
    except Exception as e:
        print(f"Error setting up database: {str(e)}")
    finally:
        db.close()
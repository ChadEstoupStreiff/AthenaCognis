import logging
import os
import shutil
import time
import traceback
from threading import Thread

import uvicorn
from controllers.FileManager import FileManager
from controllers.OCRManager import OCRManager
from controllers.PreviewManager import PreviewManager
from controllers.SummarizeManager import SummarizeManager
from controllers.TranscriptionManager import TranscriptionManager
from db import DB, ProjectFile, TagFile, Link, create_default_values, get_db
from db.models import Base, CalendarRecord, Summary, Contact, Task, KanbanBoard
from fastapi import FastAPI
from pillow_heif import register_heif_opener
from sqlalchemy import func
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from utils import walk_files

app = FastAPI()


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time
        if duration > 0.1:
            logging.critical(
                f"{request.method} {request.url.path} {response.status_code} - {duration:.3f} ms"
            )
        return response


app.add_middleware(LoggingMiddleware)

import views.files

app.include_router(views.files.router)

import views.calendar

app.include_router(views.calendar.router)

import views.ocr

app.include_router(views.ocr.router)

import views.transcription

app.include_router(views.transcription.router)

import views.summarize

app.include_router(views.summarize.router)

import views.notes

app.include_router(views.notes.router)

import views.ollama

app.include_router(views.ollama.router)

import views.projects

app.include_router(views.projects.router)

import views.tags

app.include_router(views.tags.router)

import views.stockpile

app.include_router(views.stockpile.router)

import views.chat

app.include_router(views.chat.router)

import views.link

app.include_router(views.link.router)

import views.tasks

app.include_router(views.tasks.router)

import views.utils

app.include_router(views.utils.router)

import views.settings

app.include_router(views.settings.router)

import views.contacts

app.include_router(views.contacts.router)

import views.preview

app.include_router(views.preview.router)

import views.pinned

app.include_router(views.pinned.router)


@app.get("/ocr/health")
def ocr_health():
    """
    Health check for the OCR service.
    """
    if ocr_thread.is_alive():
        return "RUNNING"
    else:
        return "DEAD"


@app.get("/transcription/health")
def transcription_health():
    """
    Health check for the transcription service.
    """
    if transcription_thread.is_alive():
        return "RUNNING"
    else:
        return "DEAD"


@app.get("/summarize/health")
def summarize_health():
    """
    Health check for the summarization service.
    """
    if summarize_thread.is_alive():
        return "RUNNING"
    else:
        return "DEAD"


def du_size(path: str) -> int:
    """Approximate `du -sb path` (sum of file sizes, no symlink following)."""
    total = 0
    stack = [path]
    while stack:
        p = stack.pop()
        try:
            with os.scandir(p) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except Exception:
                        pass
        except NotADirectoryError:
            try:
                total += os.lstat(p).st_size
            except Exception:
                pass
        except FileNotFoundError:
            pass
        except PermissionError:
            pass
    return total


@app.get("/metrics")
def metrics():
    db = get_db()
    try:
        files = walk_files()
        calendars = db.query(CalendarRecord).all()
        nbr_summaries = db.query(func.count(Summary.file)).scalar()
        nbr_links = db.query(func.count()).select_from(Link).scalar()
        nbr_contacts = db.query(func.count(Contact.id)).scalar()
        nbr_tasks = db.query(func.count(Task.id)).scalar()
        nbr_kanban_boards = db.query(func.count(KanbanBoard.id)).scalar()
        nbr_validated_tasks = db.query(func.count(Task.id)).filter(Task.completed.isnot(None)).scalar()
        # Count files per project
        files_per_project = dict(
            db.query(ProjectFile.project, func.count(ProjectFile.file))
            .group_by(ProjectFile.project)
            .all()
        )
        files_per_project = sorted(
            files_per_project.items(), key=lambda x: x[1], reverse=True
        )

        file_type_counts = {}
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext not in file_type_counts:
                file_type_counts[ext] = 0
            file_type_counts[ext] += 1
        file_type_counts = sorted(
            file_type_counts.items(), key=lambda x: x[1], reverse=True
        )

        # Count files per tag
        files_per_tag = dict(
            db.query(TagFile.tag, func.count(TagFile.file)).group_by(TagFile.tag).all()
        )
        files_per_tag = sorted(files_per_tag.items(), key=lambda x: x[1], reverse=True)

        # Set of all file names
        all_files = set(files)

        # Files with tags
        tagged_files = set(row[0] for row in db.query(TagFile.file).distinct())

        # Files in projects
        project_files = set(row[0] for row in db.query(ProjectFile.file).distinct())

        # Files with no tag or no project
        no_tag = list(all_files - tagged_files)
        no_project = list(all_files - project_files)

        back_size = (
            du_size("/root/.cache")
            + du_size("/root/.paddle")
            + du_size("/root/.paddleocr")
        )
        ollama_size = du_size("/ollama")
        mysql_size = du_size("/mysql")
        files_size = du_size("/shared")

        # Mount size at /shared (total capacity, not free)
        total, used, free = shutil.disk_usage("/shared")

    except Exception as e:
        logging.error(f"Error retrieving metrics: {str(e)}")
        db.rollback()
        logging.error(traceback.format_exc())
        return {"error": str(e)}
    finally:
        db.close()

    return {
        "nbr_calendars": len(calendars),
        "nbr_hours": sum(calendar.time_spent for calendar in calendars),
        "nbr_projects": len(files_per_project),
        "nbr_tags": len(files_per_tag),
        "nbr_files": len(all_files),
        "nbr_summaries": nbr_summaries,
        "nbr_links": nbr_links,
        "nbr_contacts": nbr_contacts,
        "nbr_tasks": nbr_tasks,
        "nbr_kanban_boards": nbr_kanban_boards,
        "nbr_validated_tasks": nbr_validated_tasks,
        "files_per_project": files_per_project,
        "files_per_tag": files_per_tag,
        "files_without_tag": len(no_tag),
        "files_without_project": len(no_project),
        "file_type_counts": file_type_counts,
        "disk_usage": {  # bytes
            "total": total,  # total size of the /shared mount
            "available": free,  # available space in bytes
            "other": used - (back_size + ollama_size + mysql_size + files_size),
            "back": back_size,  # size of .cache + .paddle + .paddleocr
            "ollama": ollama_size,
            "mysql": mysql_size,
            "files": files_size,
        },
    }


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
    )
    Base.metadata.create_all(bind=DB().engine)
    create_default_values()

    FileManager.setup()

    register_heif_opener()
    transcription_thread = Thread(target=TranscriptionManager.start_thread)
    transcription_thread.daemon = True  # Daemonize thread
    transcription_thread.start()

    summarize_thread = Thread(target=SummarizeManager.start_thread)
    summarize_thread.daemon = True  # Daemonize thread
    summarize_thread.start()

    ocr_thread = Thread(target=OCRManager.start_thread)
    ocr_thread.daemon = True  # Daemonize thread
    ocr_thread.start()

    preview_thread = Thread(target=PreviewManager.start_thread)
    preview_thread.daemon = True
    preview_thread.start()

    # if len(list_models()) == 0:
    #     pull_model(get_setting("summarization_model"))

    uvicorn.run(app, host="0.0.0.0", port=80)

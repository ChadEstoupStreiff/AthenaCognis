import logging
import mimetypes
import os
import queue
import tarfile
import time
import traceback
import zipfile
from datetime import datetime

from db import PreviewTask, TaskStateEnum, get_db
from PIL import Image
from sqlalchemy import and_
from views.settings import get_setting

try:
    import fitz  # PyMuPDF

    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False


QUALITY_MAP = {
    "low": 144,
    "medium": 360,
    "high": 720,
}

TEXT_EXTENSIONS = {
    "txt", "md", "markdown", "py", "js", "ts", "jsx", "tsx", "json",
    "csv", "xml", "html", "htm", "css", "yaml", "yml", "toml", "ini",
    "cfg", "conf", "sh", "bash", "rs", "go", "java", "c", "cpp", "h",
    "hpp", "cs", "rb", "php", "swift", "kt", "r", "sql", "log",
}

ARCHIVE_EXTENSIONS = {
    "zip", "tar", "gz", "bz2", "tgz", "7z", "rar",
}

ARCHIVE_MIMES = {
    "application/zip",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-bzip2",
    "application/x-7z-compressed",
}


def get_preview_path(file: str, is_image_preview: bool) -> str:
    relative = file.lstrip("/")
    ext = ".jpg" if is_image_preview else ".txt"
    return os.path.join("/shared/.previews", relative + ext)


class PreviewManager:
    in_progress_file = None
    queue = queue.Queue()

    def start_thread():
        db = get_db()
        pending = (
            db.query(PreviewTask)
            .filter(
                PreviewTask.state.in_(
                    [TaskStateEnum.PENDING, TaskStateEnum.IN_PROGRESS]
                )
            )
            .all()
        )
        for task in pending:
            task.state = TaskStateEnum.PENDING
            PreviewManager.queue.put(task.file)
        db.commit()
        db.close()
        PreviewManager.loop()

    @classmethod
    def loop(cls):
        time.sleep(10)
        while True:
            file = cls.queue.get()
            cls.in_progress_file = file

            db = get_db()
            try:
                task = (
                    db.query(PreviewTask)
                    .filter(
                        and_(
                            PreviewTask.file == file,
                            PreviewTask.state == TaskStateEnum.PENDING,
                        )
                    )
                    .first()
                )
                if task is None:
                    continue
                task.state = TaskStateEnum.IN_PROGRESS
                db.commit()

                quality = get_setting("preview_quality", "medium")
                target_size = QUALITY_MAP.get(quality, 360)
                text_chars = int(get_setting("preview_text_chars", 300))
                zip_subfiles = int(get_setting("preview_zip_subfiles", 15))

                mime, _ = mimetypes.guess_type(file)
                if mime is None:
                    mime = ""

                ext = os.path.splitext(file)[1].lstrip(".").lower()
                preview_path = None

                if mime.startswith("image/"):
                    preview_path = cls._generate_image_preview(file, target_size)
                elif mime == "application/pdf" or ext == "pdf":
                    preview_path = cls._generate_pdf_preview(file, target_size)
                elif mime.startswith("text/") or ext in TEXT_EXTENSIONS:
                    preview_path = cls._generate_text_preview(file, text_chars)
                elif mime in ARCHIVE_MIMES or ext in ARCHIVE_EXTENSIONS:
                    preview_path = cls._generate_zip_preview(file, zip_subfiles)

                task.state = TaskStateEnum.COMPLETED
                task.completed = datetime.now()
                task.result = preview_path or "unsupported"
                db.commit()
                logging.info(f"Preview >> Completed for file: {file}")
            except Exception as e:
                db.rollback()
                task = db.query(PreviewTask).filter(PreviewTask.file == file).first()
                if task:
                    task.state = TaskStateEnum.FAILED
                    task.completed = datetime.now()
                    task.result = str(e)
                    db.commit()
                logging.error(f"Preview >> Error for {file}: {str(e)}")
                logging.error(traceback.format_exc())
            finally:
                cls.in_progress_file = None
                db.close()

    @classmethod
    def _generate_image_preview(cls, file: str, target_size: int) -> str:
        preview_path = get_preview_path(file, True)
        os.makedirs(os.path.dirname(preview_path), exist_ok=True)

        img = Image.open(file).convert("RGB")
        w, h = img.size
        if min(w, h) > target_size:
            if w < h:
                new_w = target_size
                new_h = int(h * target_size / w)
            else:
                new_h = target_size
                new_w = int(w * target_size / h)
            img = img.resize((new_w, new_h), Image.LANCZOS)

        img.save(preview_path, "JPEG", quality=75, optimize=True)
        return preview_path

    @classmethod
    def _generate_pdf_preview(cls, file: str, target_size: int) -> str:
        if not HAS_FITZ:
            raise RuntimeError("PyMuPDF not installed; cannot generate PDF previews")

        preview_path = get_preview_path(file, True)
        os.makedirs(os.path.dirname(preview_path), exist_ok=True)

        doc = fitz.open(file)
        page = doc[0]
        rect = page.rect
        short_side = min(rect.width, rect.height)
        zoom = target_size / short_side if short_side > 0 else 1.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        doc.close()

        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img.save(preview_path, "JPEG", quality=75, optimize=True)
        return preview_path

    @classmethod
    def _generate_text_preview(cls, file: str, chars: int) -> str:
        preview_path = get_preview_path(file, False)
        os.makedirs(os.path.dirname(preview_path), exist_ok=True)

        with open(file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(chars)

        with open(preview_path, "w", encoding="utf-8") as f:
            f.write(content)

        return preview_path

    @classmethod
    def _generate_zip_preview(cls, file: str, max_entries: int) -> str:
        preview_path = get_preview_path(file, False)
        os.makedirs(os.path.dirname(preview_path), exist_ok=True)

        entries = []
        try:
            if zipfile.is_zipfile(file):
                with zipfile.ZipFile(file, "r") as zf:
                    entries = zf.namelist()[:max_entries]
            elif tarfile.is_tarfile(file):
                with tarfile.open(file, "r:*") as tf:
                    entries = [m.name for m in tf.getmembers()[:max_entries]]
        except Exception:
            entries = ["Could not read archive contents"]

        with open(preview_path, "w", encoding="utf-8") as f:
            f.write("\n".join(entries))

        return preview_path

    @classmethod
    def add_file_to_queue(cls, file):
        db = get_db()
        try:
            if (
                db.query(PreviewTask)
                .filter(PreviewTask.file == file)
                .filter(
                    PreviewTask.state.in_(
                        [TaskStateEnum.PENDING, TaskStateEnum.IN_PROGRESS]
                    )
                )
                .first()
            ):
                return
            db.add(
                PreviewTask(
                    file=file,
                    added=datetime.now(),
                    state=TaskStateEnum.PENDING,
                )
            )
            db.commit()
            cls.queue.put(file)
        except Exception as e:
            db.rollback()
            logging.error(f"Error adding {file} to preview queue: {str(e)}")
            logging.error(traceback.format_exc())
        finally:
            db.close()

    @classmethod
    def get_preview_path(cls, file: str):
        for is_image in (True, False):
            path = get_preview_path(file, is_image)
            if os.path.exists(path):
                return path
        return None

    @classmethod
    def delete(cls, file):
        db = get_db()
        try:
            tasks = db.query(PreviewTask).filter(PreviewTask.file == file).all()
            for task in tasks:
                db.delete(task)
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error deleting preview tasks for {file}: {str(e)}")
        finally:
            db.close()

        for is_image in (True, False):
            path = get_preview_path(file, is_image)
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

    @classmethod
    def move(cls, file, new_file):
        db = get_db()
        try:
            tasks = db.query(PreviewTask).filter(PreviewTask.file == file).all()
            for task in tasks:
                task.file = new_file
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error moving preview tasks for {file}: {str(e)}")
        finally:
            db.close()

        for is_image in (True, False):
            old_path = get_preview_path(file, is_image)
            new_path = get_preview_path(new_file, is_image)
            if os.path.exists(old_path):
                os.makedirs(os.path.dirname(new_path), exist_ok=True)
                os.rename(old_path, new_path)

    @classmethod
    def get_tasks(cls, file):
        db = get_db()
        tasks = db.query(PreviewTask).filter(PreviewTask.file == file).all()
        db.close()
        return [
            {
                "file": task.file,
                "state": task.state.value,
                "added": task.added.strftime("%Y-%m-%d %H:%M:%S"),
                "completed": task.completed.strftime("%Y-%m-%d %H:%M:%S")
                if task.completed
                else None,
                "result": task.result,
            }
            for task in tasks
        ]

    @classmethod
    def list_tasks(cls):
        db = get_db()
        tasks = db.query(PreviewTask).order_by(PreviewTask.added.desc()).all()
        db.close()
        return [
            {
                "file": task.file,
                "state": task.state.value,
                "added": task.added.strftime("%Y-%m-%d %H:%M:%S"),
                "completed": task.completed.strftime("%Y-%m-%d %H:%M:%S")
                if task.completed
                else None,
                "result": task.result,
            }
            for task in tasks
        ]

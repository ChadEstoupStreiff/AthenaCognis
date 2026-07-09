import logging
import queue
import subprocess
import time
import traceback
from datetime import datetime

from db import TaskStateEnum, Transcription, TranscriptionTask, get_db
from sqlalchemy import and_
from tools.ai import request_transcription
from views.settings import get_setting


class TranscriptionManager:
    in_progress_file = None
    queue = queue.Queue()

    def start_thread():
        db = get_db()
        pending = (
            db.query(TranscriptionTask)
            .filter(
                TranscriptionTask.state.in_(
                    [TaskStateEnum.PENDING, TaskStateEnum.IN_PROGRESS]
                )
            )
            .all()
        )
        for task in pending:
            task.state = TaskStateEnum.PENDING
            TranscriptionManager.queue.put(task.file)
        db.commit()
        db.close()
        TranscriptionManager.loop()

    @classmethod
    def loop(cls):
        time.sleep(10)
        while True:
            file = cls.queue.get()
            cls.in_progress_file = file

            db = get_db()
            try:
                task = (
                    db.query(TranscriptionTask)
                    .filter(
                        and_(
                            TranscriptionTask.file == file,
                            TranscriptionTask.state == TaskStateEnum.PENDING,
                        )
                    )
                    .order_by(TranscriptionTask.added.desc())
                    .first()
                )
                task.state = TaskStateEnum.IN_PROGRESS
                db.commit()

                logging.info(f"TRANSCRIPTION >> Processing file: {file}")
                transcription_type = get_setting("transcription_type", "local")
                model = get_setting("transcription_model", "small")

                if transcription_type == "local":
                    proc = subprocess.run(
                        ["python3", "/app/whisper.py", model, file],
                        capture_output=True,
                        text=True,
                    )
                    if proc.returncode != 0:
                        raise RuntimeError(
                            f"Subprocess failed with code {proc.returncode}: {proc.stderr.strip()}"
                        )
                    result = proc.stdout.strip()
                else:
                    _, _, result = request_transcription("transcription", file)
                logging.info(f"TRANSCRIPTION >> Result for file {file}: {result}")

                task.state = TaskStateEnum.COMPLETED
                task.completed = datetime.now()
                task.result = result
                db.query(Transcription).filter(Transcription.file == file).delete()
                db.add(
                    Transcription(
                        file=file,
                        date=datetime.now(),
                        transcription=result,
                    )
                )
                db.commit()
                logging.info(f"TRANSCRIPTION >> Completed processing for file: {file}")
            except Exception as e:
                db.rollback()
                task = (
                    db.query(TranscriptionTask)
                    .filter(TranscriptionTask.file == file)
                    .first()
                )
                if task:
                    task.state = TaskStateEnum.FAILED
                    task.completed = datetime.now()
                    task.result = str(e)
                    db.commit()
                logging.error(
                    f"Error processing transcription for file {file}: {str(e)}"
                )
                logging.error(traceback.format_exc())
            finally:
                cls.in_progress_file = None
                db.close()

    @classmethod
    def add_file_to_queue(cls, file):
        db = get_db()
        try:
            if (
                db.query(TranscriptionTask)
                .filter(TranscriptionTask.file == file)
                .filter(
                    TranscriptionTask.state.in_(
                        [TaskStateEnum.PENDING, TaskStateEnum.IN_PROGRESS]
                    )
                )
                .first()
            ):
                raise Exception(f"File {file} is already in the transcription queue.")
            db.add(
                TranscriptionTask(
                    file=file,
                    added=datetime.now(),
                    state=TaskStateEnum.PENDING,
                )
            )
            db.commit()
            cls.queue.put(file)
        except Exception as e:
            db.rollback()
            logging.error(f"Error adding file {file} to Transcription queue: {str(e)}")
            logging.error(traceback.format_exc())
            raise e
        finally:
            db.close()

    @classmethod
    def get(cls, file):
        db = get_db()
        transcription = (
            db.query(Transcription).filter(Transcription.file == file).first()
        )
        db.close()
        if not transcription:
            return None
        return {
            "file": transcription.file,
            "date": transcription.date,
            "transcription": transcription.transcription,
        }

    @classmethod
    def delete(cls, file):
        """
        Delete the transcription and its tasks for a given file.
        """
        db = get_db()
        try:
            transcription = (
                db.query(Transcription).filter(Transcription.file == file).first()
            )
            if transcription:
                db.delete(transcription)

            tasks = (
                db.query(TranscriptionTask).filter(TranscriptionTask.file == file).all()
            )
            for task in tasks:
                db.delete(task)
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error deleting transcription for file {file}: {str(e)}")
            logging.error(traceback.format_exc())
            raise e
        finally:
            db.close()

    @classmethod
    def move(cls, file, new_file):
        """
        Move the transcription and its tasks to a new file.
        """
        db = get_db()
        try:
            transcription = (
                db.query(Transcription).filter(Transcription.file == file).first()
            )
            if transcription:
                transcription.file = new_file

            tasks = (
                db.query(TranscriptionTask).filter(TranscriptionTask.file == file).all()
            )
            for task in tasks:
                task.file = new_file
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(
                f"Error moving transcription for file {file} to {new_file}: {str(e)}"
            )
            logging.error(traceback.format_exc())
            raise e
        finally:
            db.close()

    @classmethod
    def get_tasks(cls, file):
        db = get_db()
        tasks = db.query(TranscriptionTask).filter(TranscriptionTask.file == file).all()
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
        tasks = (
            db.query(TranscriptionTask).order_by(TranscriptionTask.added.desc()).all()
        )
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

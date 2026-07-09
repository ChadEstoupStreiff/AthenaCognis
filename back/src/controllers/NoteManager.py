from datetime import datetime

from db import Note, get_db


class NoteManager:
    @classmethod
    def get(cls, file):
        """
        Get the note for a file.
        """
        db = get_db()
        note = db.query(Note).filter(Note.file == file).first()
        db.close()

        if not note:
            return {
                "file": file,
                "date": datetime.now(),
                "note": "",
            }
        return {
            "file": note.file,
            "date": note.date,
            "note": note.note,
        }

    @classmethod
    def set(cls, file, note):
        """
        Set the note for a file.
        """
        db = get_db()
        try:
            existing_note = db.query(Note).filter(Note.file == file).first()
            if existing_note:
                existing_note.note = note
                existing_note.date = datetime.now()
            else:
                new_note = Note(file=file, date=datetime.now(), note=note)
                db.add(new_note)
            db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    @classmethod
    def delete(cls, file):
        """
        Delete the note for a file.
        """
        db = get_db()
        try:
            note = db.query(Note).filter(Note.file == file).first()
            if note:
                db.delete(note)
                db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    @classmethod
    def move(cls, file, new_file):
        """
        Move the note to a new file.
        """
        db = get_db()
        try:
            note = db.query(Note).filter(Note.file == file).first()
            if note:
                note.file = new_file
                db.commit()
            else:
                return None
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

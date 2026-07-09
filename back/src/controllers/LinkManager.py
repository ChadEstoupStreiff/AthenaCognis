import logging
import os
from datetime import datetime
from typing import List

from controllers.NoteManager import NoteManager
from controllers.SummarizeManager import SummarizeManager
from db import get_db
from db.models import ProjectFile, TagFile
from tqdm import tqdm
from utils import guess_mime, read_content
from views.settings import get_setting
from whoosh import writing
from whoosh.fields import ID, NGRAM, Schema
from whoosh.index import create_in
from whoosh.qparser import MultifieldParser, OrGroup
from whoosh.query import Every
from db.models import Link


class LinkManager:
    @classmethod
    def list_links(cls, file: str):
        db = get_db()
        try:

            links = (
                db.query(Link)
                .filter((Link.fileA == file) | (Link.fileB == file))
                .all()
            )
            result = []
            for link in links:
                if link.fileA == file:
                    result.append([link.fileB, link.force, link.comment])
                else:
                    result.append([link.fileA, link.force, link.comment])
            return result
        except Exception as e:
            logging.error(f"Error listing links for file {file}: {str(e)}")
            raise
        finally:
            db.close()

    @classmethod
    def add_link(cls, fileA: str, fileB: str, force: float = 1.0, comment: str = None):
        files = sorted([fileA, fileB])
        fileA, fileB = files[0], files[1]
        db = get_db()
        try:
            from db.models import Link

            link = Link(fileA=fileA, fileB=fileB, force=force, comment=comment)
            db.add(link)
            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error adding link between {fileA} and {fileB}: {str(e)}")
            raise
        finally:
            db.close()

    @classmethod
    def remove_link(cls, fileA: str, fileB: str):
        files = sorted([fileA, fileB])
        fileA, fileB = files[0], files[1]
        db = get_db()
        try:
            from db.models import Link

            link = (
                db.query(Link)
                .filter(Link.fileA == fileA, Link.fileB == fileB)
                .first()
            )
            if link:
                db.delete(link)
                db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error removing link between {fileA} and {fileB}: {str(e)}")
            raise
        finally:
            db.close()
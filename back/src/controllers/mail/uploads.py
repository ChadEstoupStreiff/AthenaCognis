"""Files attached in the compose dialog: stored on disk until sent or abandoned."""

import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.mail import store
from controllers.mail.smtp_client import MailFile
from db import MailDraft, MailOutgoing, MailUpload

UPLOAD_DIR = Path("/shared/.mail_attachments")
# Most mail servers refuse messages above ~25 MB.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
# Unreferenced uploads younger than this may belong to a compose dialog still open.
ORPHAN_GRACE = timedelta(days=1)
MAX_FILENAME_CHARS = 255
DEFAULT_CONTENT_TYPE = "application/octet-stream"
CONTENT_TYPE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")

JsonDict = dict[str, object]

logger = logging.getLogger(__name__)


class UploadTooLargeError(ValueError):
    """Attachment above the size limit."""


def upload_view(upload: MailUpload) -> JsonDict:
    """
    Serialize an uploaded attachment

    Args:
        upload (MailUpload): row
    Returns:
        JsonDict: id, file name, type and size
    """
    return {
        "id": upload.id,
        "filename": upload.filename,
        "content_type": upload.content_type,
        "size": upload.size,
    }


def clean_content_type(content_type: str | None) -> str:
    """
    Keep a well-formed MIME type, else the generic binary type

    Args:
        content_type (str | None): type sent by the browser
    Returns:
        str: "type/subtype"
    """
    value = (content_type or "").split(";")[0].strip().lower()
    return value if CONTENT_TYPE.match(value) else DEFAULT_CONTENT_TYPE


def clean_filename(filename: str | None) -> str:
    """
    Keep the base name of an uploaded file, without control characters

    Args:
        filename (str | None): name sent by the browser
    Returns:
        str: file name shown to recipients
    """
    base = re.split(r"[\\/]", filename or "")[-1]
    printable = "".join(char for char in base if char.isprintable()).strip()
    return printable[:MAX_FILENAME_CHARS] or "attachment"


def save_upload(filename: str | None, content_type: str | None, data: bytes) -> JsonDict:
    """
    Store an attachment until the message is sent

    Args:
        filename (str | None): original file name
        content_type (str | None): MIME type sent by the browser
        data (bytes): file content
    Returns:
        JsonDict: stored attachment
    Raises:
        UploadTooLargeError: when above MAX_UPLOAD_BYTES
    """
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadTooLargeError(
            f"Attachment above {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )
    with store.session_scope() as session:
        upload = MailUpload(
            filename=clean_filename(filename),
            content_type=clean_content_type(content_type),
            size=len(data),
            created=store.utc_now(),
        )
        session.add(upload)
        session.flush()
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        (UPLOAD_DIR / upload.id).write_bytes(data)
        return upload_view(upload)


def save_forwarded(files: list[MailFile]) -> list[JsonDict]:
    """
    Store the attachments of a forwarded message as uploads (too large ones skipped)

    Args:
        files (list[MailFile]): original attachments
    Returns:
        list[JsonDict]: stored attachments, in order
    """
    stored: list[JsonDict] = []
    for file in files:
        try:
            stored.append(save_upload(file.filename, file.content_type, file.data))
        except UploadTooLargeError:
            logger.warning("MAIL >> Forwarded attachment %s too large", file.filename)
    return stored


def encode_ids(ids: list[str]) -> str | None:
    """
    Store attachment ids in a text column

    Args:
        ids (list[str]): upload ids
    Returns:
        str | None: JSON list, None when empty
    """
    return json.dumps(ids) if ids else None


def decode_ids(raw: str | None) -> list[str]:
    """
    Read attachment ids from a text column

    Args:
        raw (str | None): JSON list or None
    Returns:
        list[str]: upload ids
    """
    return [str(value) for value in json.loads(raw)] if raw else []


def _uploads(session: Session, ids: list[str]) -> dict[str, MailUpload]:
    """
    Load uploads by id

    Args:
        session (Session): session
        ids (list[str]): upload ids
    Returns:
        dict[str, MailUpload]: found rows by id
    """
    if not ids:
        return {}
    rows = session.scalars(select(MailUpload).where(MailUpload.id.in_(ids)))
    return {row.id: row for row in rows}


def upload_views(session: Session, raw: str | None) -> list[JsonDict]:
    """
    Serialize the attachments of a draft or Outbox row, in their order

    Args:
        session (Session): session
        raw (str | None): JSON list of upload ids
    Returns:
        list[JsonDict]: attachments still stored
    """
    ids = decode_ids(raw)
    found = _uploads(session, ids)
    return [upload_view(found[upload_id]) for upload_id in ids if upload_id in found]


def check_exist(session: Session, ids: list[str]) -> None:
    """
    Make sure every attachment is still stored

    Args:
        session (Session): session
        ids (list[str]): upload ids
    Raises:
        NotFoundError: when one is missing
    """
    missing = set(ids) - set(_uploads(session, ids))
    if missing:
        raise store.NotFoundError(f"Attachment {min(missing)} not found.")


def load_files(session: Session, ids: list[str]) -> list[MailFile]:
    """
    Read attachments to send

    Args:
        session (Session): session
        ids (list[str]): upload ids
    Returns:
        list[MailFile]: files in order
    Raises:
        NotFoundError: when a row or its file is missing
    """
    check_exist(session, ids)
    found = _uploads(session, ids)
    files: list[MailFile] = []
    for upload_id in ids:
        upload = found[upload_id]
        try:
            data = (UPLOAD_DIR / upload_id).read_bytes()
        except FileNotFoundError as error:
            raise store.NotFoundError(f"Attachment {upload.filename} lost.") from error
        files.append(MailFile(upload.filename, upload.content_type, data))
    return files


def _referenced_ids(session: Session) -> set[str]:
    """
    Collect attachment ids still used by a draft or an Outbox message

    Args:
        session (Session): session
    Returns:
        set[str]: upload ids
    """
    columns = [MailDraft.attachments, MailOutgoing.attachments]
    used: set[str] = set()
    for column in columns:
        for raw in session.scalars(select(column).where(column.isnot(None))):
            used.update(decode_ids(raw))
    return used


def _delete(session: Session, uploads: list[MailUpload]) -> int:
    """
    Remove upload rows and their files

    Args:
        session (Session): session
        uploads (list[MailUpload]): rows
    Returns:
        int: removed count
    """
    for upload in uploads:
        (UPLOAD_DIR / upload.id).unlink(missing_ok=True)
        session.delete(upload)
    return len(uploads)


def delete_unreferenced(ids: list[str]) -> int:
    """
    Remove the given attachments unless a draft or Outbox message still uses them

    Args:
        ids (list[str]): upload ids (e.g. of a message just sent)
    Returns:
        int: removed count
    """
    if not ids:
        return 0
    with store.session_scope() as session:
        used = _referenced_ids(session)
        found = _uploads(session, ids)
        return _delete(session, [row for key, row in found.items() if key not in used])


def purge_orphans(now: datetime | None = None) -> int:
    """
    Remove attachments no draft or Outbox message uses, after a grace period

    Args:
        now (datetime | None): current naive UTC time, None = now
    Returns:
        int: removed count
    """
    cutoff = (now or store.utc_now()) - ORPHAN_GRACE
    with store.session_scope() as session:
        used = _referenced_ids(session)
        old = session.scalars(select(MailUpload).where(MailUpload.created < cutoff))
        removed = _delete(session, [row for row in old if row.id not in used])
    if removed:
        logger.info("MAIL >> Removed %d abandoned attachments", removed)
    return removed

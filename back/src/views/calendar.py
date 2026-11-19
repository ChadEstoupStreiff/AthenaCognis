"""Time entries (calendar records): create, edit, delete, search; projects and tags."""

import datetime
import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from controllers.calendar_links import (
    RecordLinks,
    UnknownLinkError,
    links_of,
    set_record_links,
)
from db import CalendarContact, CalendarProject, CalendarRecord, CalendarTag, Contact, get_db

HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_SERVER_ERROR = 500
START_TIME_FORMAT = "%H:%M:%S"

router = APIRouter(prefix="/calendar", tags=["Calendar"])

JsonDict = dict[str, object]


@contextmanager
def write_session(action: str) -> Iterator[Session]:
    """
    Open a session, commit on success, map errors to HTTP errors

    Args:
        action (str): what is done, for error messages
    Returns:
        Iterator[Session]: session
    Raises:
        HTTPException: 400 bad projects / tags / JSON, 500 database error
    """
    db = get_db()
    try:
        yield db
        db.commit()
    except (UnknownLinkError, json.JSONDecodeError, ValueError) as error:
        db.rollback()
        raise HTTPException(HTTP_BAD_REQUEST, str(error)) from error
    except SQLAlchemyError as error:
        db.rollback()
        logging.exception("Error %s calendar record", action)
        raise HTTPException(
            HTTP_SERVER_ERROR, f"Error {action} calendar record: {error}"
        ) from error
    finally:
        db.close()


def name_list(raw: Optional[str]) -> Optional[list[str]]:
    """
    Read a JSON list of names sent as a query parameter

    Args:
        raw (Optional[str]): JSON array, None when not sent
    Returns:
        Optional[list[str]]: names, None when not sent
    Raises:
        ValueError: not a JSON array of strings
    """
    if raw is None:
        return None
    names = json.loads(raw)
    if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
        raise ValueError("Expected a JSON array of names.")
    return names


def wanted_projects(projects: Optional[str], project: Optional[str]) -> Optional[list[str]]:
    """
    Projects asked by a request (the legacy single project still accepted)

    Args:
        projects (Optional[str]): JSON array of project names
        project (Optional[str]): legacy single project
    Returns:
        Optional[list[str]]: projects, None when neither is sent
    Raises:
        ValueError: malformed JSON array
    """
    names = name_list(projects)
    if names is None and project is not None:
        return [project]
    return names


def set_contacts(db: Session, record_id: str, contacts: str) -> None:
    """
    Replace the contacts of a record (unknown contacts skipped)

    Args:
        db (Session): session
        record_id (str): record id
        contacts (str): JSON array of contact ids
    Returns:
        None
    Raises:
        ValueError: malformed JSON array
    """
    contact_ids = name_list(contacts) or []
    db.query(CalendarContact).filter(CalendarContact.calendar_id == record_id).delete()
    for contact_id in contact_ids:
        if db.get(Contact, contact_id) is not None:
            db.add(CalendarContact(calendar_id=record_id, contact_id=contact_id))


def contacts_of(db: Session, record_id: str) -> list[JsonDict]:
    """
    Contacts of a record, as column dicts

    Args:
        db (Session): session
        record_id (str): record id
    Returns:
        list[JsonDict]: contacts
    """
    contacts = (
        db.query(Contact)
        .join(CalendarContact, CalendarContact.contact_id == Contact.id)
        .filter(CalendarContact.calendar_id == record_id)
        .all()
    )
    return [
        {column.name: getattr(contact, column.name) for column in Contact.__table__.columns}
        for contact in contacts
    ]


def record_view(db: Session, record: CalendarRecord, links: RecordLinks) -> JsonDict:
    """
    Serialize a record with its projects, tags and contacts

    Args:
        db (Session): session
        record (CalendarRecord): record
        links (RecordLinks): its projects (primary first) and tags
    Returns:
        JsonDict: record columns, projects, tags, contacts
    """
    view: JsonDict = {
        column.name: getattr(record, column.name)
        for column in CalendarRecord.__table__.columns
    }
    view["projects"] = list(links.projects)
    view["tags"] = list(links.tags)
    view["contacts"] = contacts_of(db, str(record.id))
    return view


def find_record(db: Session, record_id: str) -> CalendarRecord:
    """
    Load a record

    Args:
        db (Session): session
        record_id (str): record id
    Returns:
        CalendarRecord: record
    Raises:
        HTTPException: 404 unknown record
    """
    record = db.get(CalendarRecord, record_id)
    if record is None:
        raise HTTPException(HTTP_NOT_FOUND, "Record not found")
    return record


@router.get("/record/{record_id}")
def get_calendar_record(record_id: str) -> JsonDict:
    """
    Get one record with its projects, tags and contacts

    Args:
        record_id (str): record id
    Returns:
        JsonDict: record
    Raises:
        HTTPException: 404 unknown record
    """
    with get_db() as db:
        record = find_record(db, record_id)
        return record_view(db, record, links_of(db, [record])[record.id])


@router.post("/record")
def create_calendar_record(
    date: str,
    time_spent: float,
    title: str,
    project: Optional[str] = None,
    projects: Optional[str] = None,
    tags: Optional[str] = None,
    start_time: Optional[str] = None,
    description: Optional[str] = None,
    location: Optional[str] = None,
    attendees: Optional[str] = None,
    contacts: Optional[str] = None,
) -> JsonDict:
    """
    Create a record

    Args:
        date (str): day, "YYYY-MM-DD"
        time_spent (float): hours
        title (str): title
        project (Optional[str]): legacy single project
        projects (Optional[str]): JSON array of projects, primary first
        tags (Optional[str]): JSON array of tags
        start_time (Optional[str]): "HH:MM:SS"
        description (Optional[str]): description
        location (Optional[str]): location
        attendees (Optional[str]): attendees
        contacts (Optional[str]): JSON array of contact ids
    Returns:
        JsonDict: new record id
    Raises:
        HTTPException: 400 no project, unknown project / tag; 500 database error
    """
    with write_session("creating") as db:
        project_names = wanted_projects(projects, project) or []
        if not project_names:
            raise ValueError("A time entry needs at least one project.")
        record = CalendarRecord(
            date=date,
            start_time=datetime.datetime.strptime(start_time, START_TIME_FORMAT)
            if start_time
            else None,
            time_spent=time_spent,
            title=title,
            description=description,
            location=location,
            attendees=attendees,
        )
        db.add(record)
        db.flush()
        set_record_links(db, record, project_names, name_list(tags) or [])
        set_contacts(db, record.id, contacts or "[]")
        return {"id": record.id}


@router.put("/record/{record_id}")
def edit_calendar_record(
    record_id: str,
    title: Optional[str] = None,
    project: Optional[str] = None,
    projects: Optional[str] = None,
    tags: Optional[str] = None,
    time_spent: Optional[float] = None,
    description: Optional[str] = None,
    location: Optional[str] = None,
    attendees: Optional[str] = None,
    contacts: Optional[str] = None,
) -> JsonDict:
    """
    Edit a record (fields not sent are kept)

    Args:
        record_id (str): record id
        title (Optional[str]): title
        project (Optional[str]): legacy single project
        projects (Optional[str]): JSON array of projects, primary first
        tags (Optional[str]): JSON array of tags
        time_spent (Optional[float]): hours
        description (Optional[str]): description
        location (Optional[str]): location
        attendees (Optional[str]): attendees
        contacts (Optional[str]): JSON array of contact ids
    Returns:
        JsonDict: confirmation
    Raises:
        HTTPException: 404 unknown record, 400 empty or unknown projects / tags
    """
    with write_session("editing") as db:
        record = find_record(db, record_id)
        changes = {
            "title": title,
            "time_spent": time_spent,
            "description": description,
            "location": location,
            "attendees": attendees,
        }
        for column, value in changes.items():
            if value is not None:
                setattr(record, column, value)
        project_names = wanted_projects(projects, project)
        if project_names is not None and not project_names:
            raise ValueError("A time entry needs at least one project.")
        if project_names is not None or tags is not None:
            current = links_of(db, [record])[record.id]
            set_record_links(
                db,
                record,
                project_names if project_names is not None else current.projects,
                name_list(tags) if tags is not None else current.tags,
            )
        if contacts is not None:
            set_contacts(db, record_id, contacts)
    return {"message": "Record updated successfully"}


@router.delete("/record/{record_id}")
def delete_calendar_record(record_id: str) -> JsonDict:
    """
    Delete a record

    Args:
        record_id (str): record id
    Returns:
        JsonDict: confirmation
    Raises:
        HTTPException: 404 unknown record, 500 database error
    """
    with write_session("deleting") as db:
        db.delete(find_record(db, record_id))
    return {"message": "Record deleted successfully"}


@router.get("/search")
def search_calendar_records(
    query: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    project: Optional[str] = None,
    tag: Optional[str] = None,
) -> list[JsonDict]:
    """
    Search records by title, day range, project and tag

    Args:
        query (Optional[str]): text in the title
        start_date (Optional[str]): first day, "YYYY-MM-DD"
        end_date (Optional[str]): last day, included
        project (Optional[str]): one of the record projects
        tag (Optional[str]): one of the record tags
    Returns:
        list[JsonDict]: records, newest first
    """
    with get_db() as db:
        statement = db.query(CalendarRecord)
        if query:
            statement = statement.filter(CalendarRecord.title.ilike(f"%{query}%"))
        if start_date:
            statement = statement.filter(CalendarRecord.date >= start_date)
        if end_date:
            statement = statement.filter(CalendarRecord.date <= end_date)
        if project:
            statement = statement.join(
                CalendarProject, CalendarProject.calendar_id == CalendarRecord.id
            ).filter(CalendarProject.project == project)
        if tag:
            statement = statement.join(
                CalendarTag, CalendarTag.calendar_id == CalendarRecord.id
            ).filter(CalendarTag.tag == tag)
        records = statement.order_by(CalendarRecord.date.desc()).all()
        links = links_of(db, records)
        return [record_view(db, record, links[record.id]) for record in records]

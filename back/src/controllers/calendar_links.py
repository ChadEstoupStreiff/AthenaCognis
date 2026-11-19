"""Projects and tags of time entries (CalendarRecord ↔ Project / Tag links)."""

from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from db import CalendarProject, CalendarRecord, CalendarTag, Project, Tag


class UnknownLinkError(ValueError):
    """A project or tag given to a time entry does not exist."""


@dataclass(frozen=True)
class RecordLinks:
    """Projects (primary first) and tags of one time entry."""

    projects: tuple[str, ...] = ()
    tags: tuple[str, ...] = field(default=())


def unique(names: Sequence[str]) -> list[str]:
    """
    Drop blanks and duplicates, keeping order

    Args:
        names (Sequence[str]): names as given
    Returns:
        list[str]: trimmed names, first occurrence kept
    """
    return list(dict.fromkeys(name.strip() for name in names if name.strip()))


def check_existing(db: Session, projects: list[str], tags: list[str]) -> None:
    """
    Make sure every project and tag exists

    Args:
        db (Session): session
        projects (list[str]): project names
        tags (list[str]): tag names
    Returns:
        None
    Raises:
        UnknownLinkError: a name is unknown
    """
    known_projects = {
        name for (name,) in db.query(Project.name).filter(Project.name.in_(projects))
    }
    known_tags = {name for (name,) in db.query(Tag.name).filter(Tag.name.in_(tags))}
    missing = [name for name in projects if name not in known_projects]
    missing += [name for name in tags if name not in known_tags]
    if missing:
        raise UnknownLinkError(f"Unknown project or tag: {', '.join(missing)}.")


def set_record_links(
    db: Session, record: CalendarRecord, projects: Sequence[str], tags: Sequence[str]
) -> None:
    """
    Replace the projects and tags of a time entry (first project becomes primary)

    Args:
        db (Session): session (record flushed, so it has its id)
        record (CalendarRecord): time entry
        projects (Sequence[str]): project names, primary first
        tags (Sequence[str]): tag names
    Returns:
        None
    Raises:
        UnknownLinkError: a project or tag does not exist
    """
    project_names, tag_names = unique(projects), unique(tags)
    check_existing(db, project_names, tag_names)
    db.query(CalendarProject).filter(CalendarProject.calendar_id == record.id).delete()
    db.query(CalendarTag).filter(CalendarTag.calendar_id == record.id).delete()
    db.add_all(CalendarProject(calendar_id=record.id, project=name) for name in project_names)
    db.add_all(CalendarTag(calendar_id=record.id, tag=name) for name in tag_names)
    # Legacy single project, still read by older views: the primary one.
    record.project = project_names[0] if project_names else None


def links_by_id(db: Session, primaries: dict[str, str | None]) -> dict[str, RecordLinks]:
    """
    Projects and tags of several time entries given by id

    Args:
        db (Session): session
        primaries (dict[str, str | None]): record id → primary project
    Returns:
        dict[str, RecordLinks]: record id → links (every id present)
    """
    ids = list(primaries)
    projects: dict[str, list[str]] = {record_id: [] for record_id in ids}
    tags: dict[str, list[str]] = {record_id: [] for record_id in ids}
    project_rows = db.query(CalendarProject.calendar_id, CalendarProject.project)
    for record_id, name in project_rows.filter(CalendarProject.calendar_id.in_(ids)):
        projects[str(record_id)].append(str(name))
    tag_rows = db.query(CalendarTag.calendar_id, CalendarTag.tag)
    for record_id, name in tag_rows.filter(CalendarTag.calendar_id.in_(ids)):
        tags[str(record_id)].append(str(name))
    return {
        record_id: RecordLinks(
            tuple(
                sorted(
                    projects[record_id],
                    key=lambda name, first=primaries[record_id]: (name != first, name),
                )
            ),
            tuple(sorted(tags[record_id])),
        )
        for record_id in ids
    }


def links_of(db: Session, records: Sequence[CalendarRecord]) -> dict[str, RecordLinks]:
    """
    Projects and tags of several time entries

    Args:
        db (Session): session
        records (Sequence[CalendarRecord]): time entries
    Returns:
        dict[str, RecordLinks]: record id → links (every record present)
    """
    return links_by_id(db, {str(record.id): record.project for record in records})


def record_ids_in_project(db: Session, project: str) -> list[str]:
    """
    Ids of the time entries linked to a project

    Args:
        db (Session): session
        project (str): project name
    Returns:
        list[str]: record ids
    """
    rows = db.query(CalendarProject.calendar_id).filter(CalendarProject.project == project)
    return [str(record_id) for (record_id,) in rows]

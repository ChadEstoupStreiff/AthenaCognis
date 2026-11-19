"""Add columns declared in the models but missing from existing tables."""

import logging
import uuid

from sqlalchemy import Engine, inspect, text
from sqlalchemy.schema import Column, CreateColumn

from db.models import Base

MAIL_TABLE = "mail_message"
FLAG_TABLE = "mail_activity_flag"
LEGACY_ACTIVITY_COLUMN = "is_activity"
CALENDAR_TABLE = "CalendarRecord"
CALENDAR_PROJECT_TABLE = "calendar_project"

logger = logging.getLogger(__name__)


def missing_columns(engine: Engine) -> list[tuple[str, Column[object]]]:
    """
    List model columns absent from their existing table (new tables are skipped)

    Args:
        engine (Engine): database engine
    Returns:
        list[tuple[str, Column[object]]]: (table name, column) pairs
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    missing: list[tuple[str, Column[object]]] = []
    for table in Base.metadata.sorted_tables:
        if table.name not in tables:
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        missing.extend(
            (table.name, column)
            for column in table.columns
            if column.name not in present
        )
    return missing


def add_missing_columns(engine: Engine) -> list[str]:
    """
    ALTER existing tables to add new nullable or server-defaulted columns

    Args:
        engine (Engine): database engine
    Returns:
        list[str]: "table.column" added
    Raises:
        ValueError: when a missing column is NOT NULL without server default
    """
    added: list[str] = []
    with engine.begin() as connection:
        for table_name, column in missing_columns(engine):
            if not column.nullable and column.server_default is None:
                raise ValueError(
                    f"Cannot add {table_name}.{column.name}: NOT NULL without server default."
                )
            table = engine.dialect.identifier_preparer.quote(table_name)
            definition = CreateColumn(column).compile(dialect=engine.dialect)
            connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {definition}"))
            added.append(f"{table_name}.{column.name}")
            logger.info("Added column %s.%s", table_name, column.name)
    return added


def migrate_activity_flags(engine: Engine) -> int:
    """
    Turn the legacy mail_message.is_activity column into flag history, then drop it

    Legacy flags become one flag at the message date (past activity, no longer
    flagged today).

    Args:
        engine (Engine): database engine (run after create_all and add_missing_columns)
    Returns:
        int: legacy flags converted
    """
    present = {column["name"] for column in inspect(engine).get_columns(MAIL_TABLE)}
    if LEGACY_ACTIVITY_COLUMN not in present:
        return 0
    with engine.begin() as connection:
        rows = connection.execute(
            text(
                f"SELECT id, date FROM {MAIL_TABLE} WHERE {LEGACY_ACTIVITY_COLUMN} = 1"
            )
        ).all()
        for message_id, date in rows:
            connection.execute(
                text(
                    f"INSERT INTO {FLAG_TABLE} (id, message_id, flagged_at) "
                    "VALUES (:id, :message_id, :flagged_at)"
                ),
                {"id": str(uuid.uuid4()), "message_id": message_id, "flagged_at": date},
            )
        connection.execute(
            text(f"ALTER TABLE {MAIL_TABLE} DROP COLUMN {LEGACY_ACTIVITY_COLUMN}")
        )
    logger.info("Converted %d legacy activity flags", len(rows))
    return len(rows)


def migrate_calendar_projects(engine: Engine) -> int:
    """
    Copy the single project of each time entry into its project links (once per entry)

    Args:
        engine (Engine): database engine (run after create_all)
    Returns:
        int: entries linked
    """
    with engine.begin() as connection:
        result = connection.execute(
            text(
                f"INSERT INTO {CALENDAR_PROJECT_TABLE} (calendar_id, project) "
                f"SELECT id, project FROM {CALENDAR_TABLE} "
                "WHERE project IS NOT NULL AND id NOT IN "
                f"(SELECT calendar_id FROM {CALENDAR_PROJECT_TABLE})"
            )
        )
    linked = int(result.rowcount or 0)
    if linked:
        logger.info("Linked %d time entries to their project", linked)
    return linked

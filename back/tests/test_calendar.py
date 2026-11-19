import json
from datetime import datetime

import pytest
from conftest import SessionFactory
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import views.calendar
from db import CalendarProject, CalendarRecord, Project, Tag
from db.migrate import migrate_calendar_projects

DAY = "2026-11-19"


@pytest.fixture
def client(session_factory: SessionFactory) -> TestClient:
    """
    Calendar API on the test database, with projects Alpha / Beta and tag Deep

    Args:
        session_factory (SessionFactory): test database
    Returns:
        TestClient: client
    """
    with session_factory() as db:
        db.add_all(
            [
                Project(name="Alpha", color="#000"),
                Project(name="Beta", color="#111"),
                Tag(name="Deep", color="#222"),
            ]
        )
        db.commit()
    app = FastAPI()
    app.include_router(views.calendar.router)
    return TestClient(app)


def create(client: TestClient, **params: str) -> str:
    """
    Create a one-hour record

    Args:
        client (TestClient): client
        params (str): extra query parameters
    Returns:
        str: new record id
    """
    response = client.post(
        "/calendar/record",
        params={"date": DAY, "time_spent": "1", "title": "Work", **params},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


def search(client: TestClient, **params: str) -> list[dict[str, object]]:
    """
    Search records of the day

    Args:
        client (TestClient): client
        params (str): extra filters
    Returns:
        list[dict[str, object]]: records
    """
    response = client.get(
        "/calendar/search", params={"start_date": DAY, "end_date": DAY, **params}
    )
    return list(response.json())


def test_records_have_several_projects_and_tags(client: TestClient) -> None:
    record_id = create(
        client, projects=json.dumps(["Beta", "Alpha"]), tags=json.dumps(["Deep"])
    )
    [record] = search(client)
    assert (record["projects"], record["tags"], record["project"]) == (
        ["Beta", "Alpha"],
        ["Deep"],
        "Beta",
    )
    assert [item["id"] for item in search(client, project="Alpha")] == [record_id]
    assert [item["id"] for item in search(client, tag="Deep")] == [record_id]
    assert search(client, project="Nope") == []


def test_edit_replaces_links_and_keeps_unsent_ones(client: TestClient) -> None:
    record_id = create(client, projects=json.dumps(["Alpha"]), tags=json.dumps(["Deep"]))
    client.put(f"/calendar/record/{record_id}", params={"projects": json.dumps(["Beta"])})
    record = client.get(f"/calendar/record/{record_id}").json()
    assert (record["projects"], record["tags"]) == (["Beta"], ["Deep"])
    client.put(f"/calendar/record/{record_id}", params={"tags": "[]"})
    assert client.get(f"/calendar/record/{record_id}").json()["tags"] == []


def test_legacy_single_project_still_accepted(client: TestClient) -> None:
    create(client, project="Alpha")
    assert search(client)[0]["projects"] == ["Alpha"]


def test_bad_links_are_rejected(client: TestClient) -> None:
    base = {"date": DAY, "time_spent": "1", "title": "Work"}
    unknown = client.post(
        "/calendar/record", params={**base, "projects": json.dumps(["Nope"])}
    )
    assert unknown.status_code == 400
    empty = client.post("/calendar/record", params={**base, "projects": "[]"})
    assert empty.status_code == 400
    assert search(client) == []


def test_delete_removes_the_record(client: TestClient) -> None:
    record_id = create(client, projects=json.dumps(["Alpha"]))
    assert client.delete(f"/calendar/record/{record_id}").status_code == 200
    assert client.delete(f"/calendar/record/{record_id}").status_code == 404


def test_migration_links_legacy_projects_once(session_factory: SessionFactory) -> None:
    with session_factory() as db:
        db.add(Project(name="Alpha", color="#000"))
        db.add_all(
            [
                CalendarRecord(
                    id="old", project="Alpha", date=datetime(2026, 1, 1), time_spent=1, title="a"
                ),
                CalendarRecord(
                    id="none", project=None, date=datetime(2026, 1, 1), time_spent=1, title="b"
                ),
            ]
        )
        db.commit()
        engine = db.get_bind()
    assert migrate_calendar_projects(engine) == 1  # type: ignore[arg-type]
    assert migrate_calendar_projects(engine) == 0  # type: ignore[arg-type]
    with session_factory() as db:
        assert linked(db) == [("old", "Alpha")]


def linked(db: Session) -> list[tuple[str, str]]:
    """
    Every project link

    Args:
        db (Session): session
    Returns:
        list[tuple[str, str]]: (record id, project)
    """
    return [
        (str(record_id), str(project))
        for record_id, project in db.query(
            CalendarProject.calendar_id, CalendarProject.project
        )
    ]

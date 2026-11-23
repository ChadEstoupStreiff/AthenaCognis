from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import views.activity_generation
from controllers.activity.generation_status import DayStatus, LatestRun, day_statuses
from controllers.activity.off_days import OffDayRules
from db import ActivityGenerationTask, TaskStateEnum
from conftest import SessionFactory

WEEKDAYS_ONLY = OffDayRules(weekdays=("mon", "tue", "wed", "thu", "fri"))


def test_day_statuses_prefer_runs_over_skips() -> None:
    days = [date(2026, 11, day) for day in (20, 21, 22, 23, 24)]
    runs = {
        "2026-11-20": LatestRun(TaskStateEnum.COMPLETED, "Generated summary note."),
        "2026-11-21": LatestRun(TaskStateEnum.FAILED, "No activity."),
        "2026-11-23": LatestRun(TaskStateEnum.IN_PROGRESS, None),
    }
    skipped = {"2026-11-21": "Saturday not picked", "2026-11-22": "Sunday not picked"}
    assert day_statuses(days, runs, skipped, WEEKDAYS_ONLY) == [
        DayStatus("2026-11-20", "generated", None, None),
        DayStatus("2026-11-21", "failed", "No activity.", "Saturday not picked"),
        DayStatus("2026-11-22", "skipped", "Sunday not picked", "Sunday not picked"),
        DayStatus("2026-11-23", "running", None, None),
        DayStatus("2026-11-24", None, None, None),
    ]


def test_daily_status_route(
    session_factory: SessionFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings: dict[str, object] = {
        "activity_generation_daily_weekdays": ["mon", "tue", "wed", "thu", "fri"],
        "activity_generation_daily_skipped": {"2026-11-22": "Sunday not picked"},
    }
    monkeypatch.setattr(views.activity_generation, "get_setting", settings.get)
    with session_factory() as db:
        for added, state in ((1, TaskStateEnum.FAILED), (2, TaskStateEnum.COMPLETED)):
            db.add(
                ActivityGenerationTask(
                    file="daily/2026-11-20", added=datetime(2026, 11, 21, added), state=state
                )
            )
        db.commit()
    app = FastAPI()
    app.include_router(views.activity_generation.router)
    client = TestClient(app)
    response = client.get("/activity-generation/daily-status?first=2026-11-20&last=2026-11-22")
    assert [(day["day"], day["state"], day["off"]) for day in response.json()] == [
        ("2026-11-20", "generated", None),
        ("2026-11-21", None, "Saturday not picked"),
        ("2026-11-22", "skipped", "Sunday not picked"),
    ]
    too_long = client.get("/activity-generation/daily-status?first=2020-01-01&last=2026-01-01")
    assert too_long.status_code == 400
    assert client.get("/activity-generation/daily-status?first=bad&last=x").status_code == 400

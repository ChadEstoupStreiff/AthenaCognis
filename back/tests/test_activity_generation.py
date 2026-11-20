from dataclasses import dataclass, field
from datetime import datetime, time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import controllers.ActivityGenerationManager as generation_manager
import views.activity_generation
from controllers.activity.base import Activity, SourceUnavailableError, TimeRange
from controllers.activity.generation import (
    ACTIVITY_PROJECT,
    Catalog,
    DailyRequest,
    GenerationRequestError,
    SourceSection,
    parse_time_entries,
)
from controllers.activity.generation_prompt import (
    SUMMARY_MARKER,
    TIME_MARKER,
    build_prompt,
    part_stats,
    split_answer,
)
from controllers.ActivityGenerationManager import ActivityGenerationManager
from controllers.calendar_links import links_of
from db import CalendarRecord, Project, ProjectFile, Tag, TaskStateEnum
from conftest import SessionFactory

DAY = "2026-11-19"
# Local day in UTC+1: 2026-11-18 23:00 → 2026-11-19 23:00 UTC.
START = datetime(2026, 11, 18, 23)
END = datetime(2026, 11, 19, 23)
OFFSET = 60
TIME_ANSWER = """```json
[{"start": "09:00", "end": "10:30", "title": "Mail triage", "description": "Inbox",
  "projects": ["alpha", "Unknown"], "tags": ["Deep", "deep"]},
 {"start": "10:00", "end": "11:00", "title": "Overlap", "description": ""},
 {"start": "14:00", "end": "13:00", "title": "Backwards", "description": ""},
 {"start": "14:00", "end": "15:15", "title": "Activity page", "description": "Code"}]
```"""
SUMMARY_ANSWER = "Coded the **Activity** page."


def request(outputs: tuple[str, ...] = ("summary", "time")) -> DailyRequest:
    """
    Build a valid daily request

    Args:
        outputs (tuple[str, ...]): outputs to generate
    Returns:
        DailyRequest: request
    """
    return DailyRequest(DAY, START, END, OFFSET, ("github",), outputs)  # type: ignore[arg-type]


def activity(hour: int, title: str) -> Activity:
    """
    Build an activity at an hour of 2026-11-19 (UTC)

    Args:
        hour (int): UTC hour
        title (str): title
    Returns:
        Activity: activity
    """
    return Activity(f"id-{hour}", "github", "push", datetime(2026, 11, 19, hour), title)


@dataclass
class Descriptor:
    """Label of a fake source."""

    label: str


@dataclass
class FakeSource:
    """Data source answering fixed activities (or failing)."""

    items: list[Activity] = field(default_factory=list)
    failure: str = ""
    descriptor: Descriptor = field(default_factory=lambda: Descriptor("GitHub"))

    def instruction(self) -> str:
        """
        User instruction of the source

        Returns:
            str: instruction
        """
        return "Name the repositories."

    def activities(self, window: TimeRange, limit: int) -> list[Activity]:
        """
        Answer the fixed activities

        Args:
            window (TimeRange): time window
            limit (int): maximum count
        Returns:
            list[Activity]: activities
        Raises:
            SourceUnavailableError: when the source is set to fail
        """
        del window, limit
        if self.failure:
            raise SourceUnavailableError(self.failure)
        return self.items


@dataclass
class Llm:
    """Fake LLM recording prompts."""

    prompts: list[str] = field(default_factory=list)

    def __call__(self, prompt: str) -> str:
        """
        Answer a summary or time entries

        Args:
            prompt (str): prompt
        Returns:
            str: answer
        """
        self.prompts.append(prompt)
        sections = []
        if SUMMARY_MARKER in prompt:
            sections.append(f"{SUMMARY_MARKER}\n{SUMMARY_ANSWER}")
        if TIME_MARKER in prompt:
            sections.append(f"{TIME_MARKER}\n{TIME_ANSWER}")
        return "\n".join(sections)


@pytest.fixture
def source(monkeypatch: pytest.MonkeyPatch) -> FakeSource:
    """
    Serve one fake source to the generation

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        FakeSource: source, editable
    """
    fake = FakeSource([activity(8, "Pushed 1 commit"), activity(13, "Opened PR #4")])
    monkeypatch.setattr(generation_manager, "get_source", lambda key: fake)
    return fake


@pytest.fixture
def catalog(session_factory: SessionFactory) -> None:
    """
    Create the projects and tags offered to the LLM

    Args:
        session_factory (SessionFactory): test database
    """
    with session_factory() as db:
        db.add_all([Project(name="Alpha", color="#000"), Tag(name="Deep", color="#111")])
        db.commit()


@pytest.fixture
def llm(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Llm:
    """
    Fake LLM and shared root of the generation

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        tmp_path (Path): temporary folder
    Returns:
        Llm: fake LLM
    """
    fake = Llm()
    monkeypatch.setattr(ActivityGenerationManager, "llm", staticmethod(fake))
    monkeypatch.setattr(ActivityGenerationManager, "root", tmp_path)
    return fake


def run(daily: DailyRequest) -> None:
    """
    Queue a request and process it synchronously

    Args:
        daily (DailyRequest): request
    """
    ActivityGenerationManager.request_daily(daily)
    ActivityGenerationManager.handle(daily.key)


def test_request_validation() -> None:
    with pytest.raises(GenerationRequestError):
        DailyRequest("19/11", START, END, OFFSET, ("github",), ("summary",))
    with pytest.raises(GenerationRequestError):
        DailyRequest(DAY, END, START, OFFSET, ("github",), ("summary",))
    with pytest.raises(GenerationRequestError):
        DailyRequest(DAY, START, END, OFFSET, (), ("summary",))
    with pytest.raises(GenerationRequestError):
        DailyRequest(DAY, START, END, OFFSET, ("github",), ())
    stored = request()
    assert DailyRequest.from_json(stored.to_json()) == stored


CATALOG = Catalog((("Alpha", "Main work"), ("Beta", "")), ("Deep",))
SECTIONS = [
    SourceSection("GitHub", "Name repos.", (activity(13, "PR"), activity(8, "Push"))),
    SourceSection("Calendars", "", (), "server down"),
]


def test_prompt_uses_local_times_and_keeps_errors() -> None:
    text = build_prompt(DAY, SECTIONS, ("summary", "time"), CATALOG, OFFSET).text()
    assert text.index("[09:00] push — Push") < text.index("[14:00] push — PR")
    assert "Instruction from the user: Name repos." in text
    assert "(could not be read: server down)" in text
    assert text.index(SUMMARY_MARKER) < text.index(TIME_MARKER)
    assert "- Alpha: Main work" in text


def test_summary_only_prompt_skips_catalog_and_time_task() -> None:
    text = build_prompt(DAY, SECTIONS, ("summary",), CATALOG, OFFSET).text()
    assert SUMMARY_MARKER in text
    assert TIME_MARKER not in text
    assert "PROJECTS AND TAGS" not in text


def test_split_answer_reads_each_section() -> None:
    answer = f"{SUMMARY_MARKER}\n# Day\n\n{TIME_MARKER}\n```json\n[]\n```"
    assert split_answer(answer, ("summary", "time")) == {"summary": "# Day", "time": "[]"}
    assert split_answer("== time entries ==\n[]", ("time",)) == {"time": "[]"}
    assert split_answer("Plain journal", ("summary",)) == {"summary": "Plain journal"}
    with pytest.raises(ValueError, match="time"):
        split_answer(f"{SUMMARY_MARKER}\nOnly this", ("summary", "time"))


def test_part_stats_measure_each_block() -> None:
    prompt = build_prompt(DAY, SECTIONS, ("time",), CATALOG, OFFSET)
    stats = part_stats(prompt)
    assert [(item.label, item.kind) for item in stats] == [
        ("Instructions", "instructions"),
        ("GitHub", "source"),
        ("Calendars", "source"),
        ("Projects and tags", "catalog"),
    ]
    github = stats[1]
    assert github.activities == 2
    assert github.stats.characters == len(prompt.parts[1].text)
    assert stats[2].error == "server down"


def test_time_entries_drop_fences_overlaps_and_bad_blocks() -> None:
    entries = parse_time_entries(TIME_ANSWER, CATALOG)
    assert [(entry.start, entry.title, entry.hours) for entry in entries] == [
        (time(9), "Mail triage", 1.5),
        (time(14), "Activity page", 1.25),
    ]
    assert (entries[0].projects, entries[0].tags) == (("Alpha",), ("Deep",))
    assert (entries[1].projects, entries[1].tags) == ((), ())
    with pytest.raises(ValueError):
        parse_time_entries("Sorry, no JSON", CATALOG)


def test_catalog_lists_projects_and_tags() -> None:
    assert CATALOG.text() == "Projects:\n- Alpha: Main work\n- Beta\nTags:\n- Deep"
    assert Catalog().text() == "Projects:\n(none)\nTags:\n(none)"


def test_daily_generation_writes_note_and_time_entries(
    session_factory: SessionFactory,
    catalog: None,
    source: FakeSource,
    llm: Llm,
    tmp_path: Path,
) -> None:
    run(request())
    note = tmp_path / DAY / "notes" / "Daily activity.md"
    assert note.read_text(encoding="utf-8").startswith(f"# ⚡ Daily activity — {DAY}")
    assert "[09:00] push — Pushed 1 commit" in llm.prompts[0]
    with session_factory() as db:
        assert db.get(Project, ACTIVITY_PROJECT) is not None
        assert db.get(ProjectFile, (ACTIVITY_PROJECT, str(note))) is not None
        records = db.query(CalendarRecord).order_by(CalendarRecord.start_time).all()
        assert [(record.title, record.time_spent) for record in records] == [
            ("Mail triage", 1.5),
            ("Activity page", 1.25),
        ]
        assert all(record.project == ACTIVITY_PROJECT for record in records)
        links = links_of(db, records)
        assert links[records[0].id].projects == (ACTIVITY_PROJECT, "Alpha")
        assert links[records[0].id].tags == ("Deep",)
        assert links[records[1].id].projects == (ACTIVITY_PROJECT,)
    assert len(llm.prompts) == 1
    assert "- Alpha" in llm.prompts[0] and "- Deep" in llm.prompts[0]
    assert f"- {ACTIVITY_PROJECT}" not in llm.prompts[0]


def test_regeneration_replaces_time_entries(
    session_factory: SessionFactory, catalog: None, source: FakeSource, llm: Llm
) -> None:
    run(request(("time",)))
    run(request(("time",)))
    with session_factory() as db:
        assert db.query(CalendarRecord).count() == 2
    assert len(llm.prompts) == 2


def test_no_activity_fails_without_writing(
    session_factory: SessionFactory, source: FakeSource, llm: Llm, tmp_path: Path
) -> None:
    source.items = []
    source.failure = "GitHub down"
    run(request())
    assert llm.prompts == []
    assert not (tmp_path / DAY).exists()
    tasks = ActivityGenerationManager.list_tasks()
    assert tasks[0].state == TaskStateEnum.FAILED.value
    assert tasks[0].result == "No activity in the picked data sources."


def test_api_queues_and_reads_a_day(
    session_factory: SessionFactory, catalog: None, source: FakeSource, llm: Llm
) -> None:
    app = FastAPI()
    app.include_router(views.activity_generation.router)
    client = TestClient(app)
    body = {
        "day": DAY,
        "start": "2026-11-18T23:00:00Z",
        "end": "2026-11-19T23:00:00Z",
        "utc_offset_minutes": OFFSET,
        "sources": ["github"],
        "outputs": ["summary", "time"],
    }
    assert client.get(f"/activity-generation/daily/{DAY}").json()["task"] is None
    assert client.post("/activity-generation/daily", json=body).json() == {
        "key": f"daily/{DAY}"
    }
    assert client.post("/activity-generation/daily", json=body).status_code == 409
    ActivityGenerationManager.handle(f"daily/{DAY}")
    day = client.get(f"/activity-generation/daily/{DAY}").json()
    assert day["task"]["state"] == "COMPLETED"
    assert day["note"]["content"].startswith("# ⚡ Daily activity")
    assert [
        (item["start"], item["title"], item["projects"], item["tags"])
        for item in day["records"]
    ] == [
        ("09:00", "Mail triage", ["Alpha"], ["Deep"]),
        ("14:00", "Activity page", [], []),
    ]
    assert client.get("/activity-generation/tasks").json()[0]["label"] == f"Daily · {DAY}"
    bad = {**body, "outputs": []}
    assert client.post("/activity-generation/daily", json=bad).status_code == 400


def test_dry_run_builds_prompts_without_llm(
    session_factory: SessionFactory, catalog: None, source: FakeSource, llm: Llm
) -> None:
    app = FastAPI()
    app.include_router(views.activity_generation.router)
    client = TestClient(app)
    body = {
        "day": DAY,
        "start": "2026-11-18T23:00:00Z",
        "end": "2026-11-19T23:00:00Z",
        "utc_offset_minutes": OFFSET,
        "sources": ["github"],
        "outputs": ["summary", "time"],
    }
    result = client.post("/activity-generation/daily/dry-run", json=body).json()
    assert llm.prompts == []
    assert ActivityGenerationManager.list_tasks() == []
    assert "[09:00] push — Pushed 1 commit" in result["prompt"]
    assert SUMMARY_MARKER in result["prompt"] and TIME_MARKER in result["prompt"]
    assert "- Alpha" in result["prompt"]
    assert result["stats"]["characters"] == len(result["prompt"])
    assert result["stats"]["estimated_tokens"] == -(-len(result["prompt"]) // 4)
    github = next(part for part in result["parts"] if part["label"] == "GitHub")
    assert (github["kind"], github["activities"], github["error"]) == ("source", 2, "")
    assert github["stats"]["characters"] > 0
    assert result["context_tokens"] > 0
    bad = {**body, "sources": []}
    assert client.post("/activity-generation/daily/dry-run", json=bad).status_code == 400

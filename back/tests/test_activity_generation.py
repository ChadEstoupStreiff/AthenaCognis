from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path

import pytest
from conftest import SessionFactory
from fastapi import FastAPI
from fastapi.testclient import TestClient

import controllers.ActivityGenerationManager as generation_manager
import views.activity_generation
from controllers.activity.base import Activity, SourceUnavailableError, TimeRange
from controllers.activity.generation import (
    ACTIVITY_PROJECT,
    GenerationRequest,
    GenerationRequestError,
    SourceSection,
    SummarySection,
    note_markdown,
    note_path,
    period_days,
)
from controllers.activity.generation_context import generated_sections
from controllers.activity.generation_prompt import (
    OUTPUT_MARKERS,
    build_prompt,
    part_stats,
    split_answer,
)
from controllers.activity.generation_time import Catalog, parse_time_entries
from controllers.ActivityGenerationManager import ActivityGenerationManager
from controllers.calendar_links import links_of
from db import CalendarRecord, Project, ProjectFile, Tag, TaskStateEnum

DAY = "2026-11-19"
# Local day in UTC+1: 2026-11-18 23:00 → 2026-11-19 23:00 UTC.
START = datetime(2026, 11, 18, 23)
END = datetime(2026, 11, 19, 23)
OFFSET = 60
WEEK = "2026-11-16"
MONTH = "2026-11-01"
SUMMARY_ANSWER = "```markdown\nCoded the **Activity** page.\n```"
TIME_ANSWER = """```json
[{"start": "09:00", "end": "10:30", "title": "Mail triage", "description": "Inbox",
  "projects": ["alpha", "Unknown"], "tags": ["Deep", "deep"]},
 {"start": "10:00", "end": "11:00", "title": "Overlap", "description": ""},
 {"start": "14:00", "end": "13:00", "title": "Backwards", "description": ""},
 {"start": "14:00", "end": "15:15", "title": "Activity page", "description": "Code"}]
```"""
SUMMARY_MARKER = OUTPUT_MARKERS["summary"]
TIME_MARKER = OUTPUT_MARKERS["time"]
INSTRUCTION = "Write in French."
BOTH = ("summary", "time")
CATALOG = Catalog((("Alpha", "Main work"), ("Beta", "")), ("Deep",))


def request(instruction: str = "", outputs: tuple[str, ...] = ("summary",)) -> GenerationRequest:
    """
    Build a valid daily request

    Args:
        instruction (str): custom instruction
        outputs (tuple[str, ...]): outputs to generate
    Returns:
        GenerationRequest: request
    """
    return GenerationRequest(
        "daily",
        DAY,
        START,
        END,
        OFFSET,
        "sources",
        ("github",),
        instruction,
        outputs=outputs,  # type: ignore[arg-type]
    )


def weekly(basis: str = "generated") -> GenerationRequest:
    """
    Build a valid weekly request (week of 2026-11-16, UTC+1)

    Args:
        basis (str): context
    Returns:
        GenerationRequest: request
    """
    sources = ("github",) if basis == "sources" else ()
    return GenerationRequest(
        "weekly",
        WEEK,
        datetime(2026, 11, 15, 23),
        datetime(2026, 11, 22, 23),
        OFFSET,
        basis,  # type: ignore[arg-type]
        sources,
        INSTRUCTION,
    )


def monthly(basis: str = "generated", fill_daily: bool = False) -> GenerationRequest:
    """
    Build a valid monthly request (November 2026, UTC+1)

    Args:
        basis (str): context
        fill_daily (bool): fill uncovered days with daily summaries
    Returns:
        GenerationRequest: request
    """
    return GenerationRequest(
        "monthly",
        MONTH,
        datetime(2026, 10, 31, 23),
        datetime(2026, 11, 30, 23),
        OFFSET,
        basis,  # type: ignore[arg-type]
        fill_daily=fill_daily,
    )


def write_note(root: Path, span: str, day: str, text: str) -> None:
    """
    Write a generated note as the daemon does

    Args:
        root (Path): shared root
        span (str): time span
        day (str): first day
        text (str): summary
    """
    path = note_path(root, span, day)  # type: ignore[arg-type]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(note_markdown(span, day, text), encoding="utf-8")  # type: ignore[arg-type]


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
        Answer a fenced summary, or the sections the prompt asks with markers

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
        return "\n".join(sections) or SUMMARY_ANSWER


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


def run(generation: GenerationRequest) -> None:
    """
    Queue a request and process it synchronously

    Args:
        generation (GenerationRequest): request
    """
    ActivityGenerationManager.request(generation)
    ActivityGenerationManager.handle(generation.key)


def test_request_validation() -> None:
    with pytest.raises(GenerationRequestError):
        GenerationRequest("daily", "19/11", START, END, OFFSET, "sources", ("github",))
    with pytest.raises(GenerationRequestError):
        GenerationRequest("daily", DAY, END, START, OFFSET, "sources", ("github",))
    with pytest.raises(GenerationRequestError):
        GenerationRequest("daily", DAY, START, END, OFFSET, "sources", ())
    with pytest.raises(GenerationRequestError, match="not offered"):
        GenerationRequest("daily", DAY, START, END, OFFSET, "generated")
    with pytest.raises(GenerationRequestError, match="1st"):
        GenerationRequest("monthly", DAY, START, END, OFFSET, "generated")
    with pytest.raises(GenerationRequestError, match="too long"):
        GenerationRequest("daily", DAY, START, datetime(2026, 11, 25), OFFSET, "sources", ("a",))
    with pytest.raises(GenerationRequestError, match="instruction"):
        request("x" * 2001)
    with pytest.raises(GenerationRequestError, match="both"):
        request(outputs=())
    with pytest.raises(GenerationRequestError, match="both"):
        request(outputs=("bogus",))
    stored = (request(INSTRUCTION, BOTH), weekly(), monthly("generated", fill_daily=True))
    for item in stored:
        assert GenerationRequest.from_json(item.to_json()) == item


def test_time_entries_for_days_only() -> None:
    assert request(outputs=("time",)).outputs == ("time",)
    with pytest.raises(GenerationRequestError, match="days only"):
        GenerationRequest(
            "weekly",
            WEEK,
            datetime(2026, 11, 15, 23),
            datetime(2026, 11, 22, 23),
            OFFSET,
            "generated",
            outputs=BOTH,  # type: ignore[arg-type]
        )


def test_old_stored_request_reads_as_daily_from_sources() -> None:
    raw = (
        '{"day": "2026-11-19", "start": "2026-11-18T23:00:00", "end": "2026-11-19T23:00:00",'
        ' "utc_offset_minutes": 60, "sources": ["github"], "outputs": ["summary", "time"]}'
    )
    assert GenerationRequest.from_json(raw) == request(outputs=BOTH)
    without_outputs = raw.replace(', "outputs": ["summary", "time"]', "")
    assert GenerationRequest.from_json(without_outputs) == request()


def test_period_days() -> None:
    assert period_days("daily", date(2026, 11, 19)) == (date(2026, 11, 19),)
    assert len(period_days("weekly", date(2026, 11, 16))) == 7
    assert len(period_days("monthly", date(2026, 2, 1))) == 28
    assert period_days("monthly", date(2026, 12, 1))[-1] == date(2026, 12, 31)


SECTIONS = [
    SourceSection("GitHub", "Name repos.", (activity(13, "PR"), activity(8, "Push"))),
    SourceSection("Calendars", "", (), "server down"),
]


def test_daily_prompt_uses_local_times_and_keeps_errors() -> None:
    text = build_prompt(request(), SECTIONS, []).text()
    assert text.index("[09:00] push — Push") < text.index("[14:00] push — PR")
    assert "Instruction from the user: Name repos." in text
    assert "(could not be read: server down)" in text
    assert f'<activity day="{DAY}">' in text
    assert "end-of-day journal" in text
    assert "Custom instruction" not in text
    assert "time entries" not in text.lower()


def test_daily_prompt_with_time_entries_lists_catalog_and_markers() -> None:
    text = build_prompt(request(outputs=BOTH), SECTIONS, [], CATALOG).text()
    assert "Do every task below." in text
    assert "SUMMARY: Write the user's end-of-day journal" in text
    assert "TIME ENTRIES: Turn the activity into the time entries" in text
    assert text.index(SUMMARY_MARKER) < text.index(TIME_MARKER)
    assert "<projects_and_tags>" in text and "- Alpha: Main work" in text
    assert text.index("<projects_and_tags>") < text.index("Do every task below.")


def test_time_only_prompt_skips_journal_task() -> None:
    text = build_prompt(request(outputs=("time",)), SECTIONS, [], CATALOG).text()
    assert TIME_MARKER in text and SUMMARY_MARKER not in text
    assert "end-of-day journal" not in text


def test_split_answer_reads_each_section() -> None:
    answer = f"{SUMMARY_MARKER}\n# Day\n\n{TIME_MARKER}\n```json\n[]\n```"
    assert split_answer(answer, BOTH) == {"summary": "# Day", "time": "[]"}  # type: ignore[arg-type]
    assert split_answer("== time entries ==\n[]", ("time",)) == {"time": "[]"}
    assert split_answer("```\nPlain journal\n```", ("summary",)) == {"summary": "Plain journal"}
    with pytest.raises(ValueError, match="time"):
        split_answer(f"{SUMMARY_MARKER}\nOnly this", BOTH)  # type: ignore[arg-type]


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
    with pytest.raises(TypeError):
        parse_time_entries('{"start": "09:00"}', CATALOG)


def test_catalog_lists_projects_and_tags() -> None:
    assert CATALOG.text() == "Projects:\n- Alpha: Main work\n- Beta\nTags:\n- Deep"
    assert Catalog().text() == "Projects:\n(none)\nTags:\n(none)"


def test_prompt_adds_custom_instruction() -> None:
    text = build_prompt(request(f"  {INSTRUCTION}  "), SECTIONS, []).text()
    assert "Custom instruction from the user for this journal" in text
    assert text.rstrip().endswith("no code fence.")
    assert INSTRUCTION in text


def test_weekly_prompt_dates_activities_and_lists_summaries() -> None:
    sources = build_prompt(weekly("sources"), SECTIONS, []).text()
    assert "[Thu 2026-11-19 09:00] push — Push" in sources
    assert '<activity week="Week of 2026-11-16">' in sources
    summaries = [SummarySection("Day · Monday 2026-11-16", "Did A.")]
    text = build_prompt(weekly(), [], summaries).text()
    assert "### Day · Monday 2026-11-16\nDid A." in text
    assert "weekly journal" in text and INSTRUCTION in text


def test_part_stats_measure_each_block() -> None:
    prompt = build_prompt(request(outputs=BOTH), SECTIONS, [SummarySection("Week", "Text")])
    stats = part_stats(prompt)
    assert [(item.label, item.kind) for item in stats] == [
        ("Instructions", "instructions"),
        ("GitHub", "source"),
        ("Calendars", "source"),
        ("Week", "summary"),
        ("Projects and tags", "catalog"),
    ]
    github = stats[1]
    assert github.activities == 2
    assert github.stats.characters == len(prompt.parts[1].text)
    assert stats[2].error == "server down"


def test_weekly_context_reads_daily_notes_of_the_week(tmp_path: Path) -> None:
    write_note(tmp_path, "daily", "2026-11-16", "Monday work.")
    write_note(tmp_path, "daily", "2026-11-18", "Wednesday work.")
    write_note(tmp_path, "daily", "2026-11-23", "Next week.")
    sections = generated_sections(tmp_path, weekly())
    assert [(item.label, item.text) for item in sections] == [
        ("Day · Monday 2026-11-16", "Monday work."),
        ("Day · Wednesday 2026-11-18", "Wednesday work."),
    ]


def test_monthly_context_reads_weeks_and_fills_gaps(tmp_path: Path) -> None:
    # Week of Oct 26 overlaps Nov 1; week of Nov 16 is missing.
    for week in ("2026-10-26", "2026-11-02", "2026-11-09", "2026-11-23"):
        write_note(tmp_path, "weekly", week, f"Week {week}.")
    write_note(tmp_path, "daily", "2026-11-17", "Gap day.")
    write_note(tmp_path, "daily", "2026-11-10", "Covered day.")
    weeks = generated_sections(tmp_path, monthly())
    assert [item.label for item in weeks] == [
        "Week · 2026-10-26 → 2026-11-01",
        "Week · 2026-11-02 → 2026-11-08",
        "Week · 2026-11-09 → 2026-11-15",
        "Week · 2026-11-23 → 2026-11-29",
    ]
    filled = generated_sections(tmp_path, monthly(fill_daily=True))
    assert [item.text for item in filled[len(weeks) :]] == ["Gap day."]
    daily = generated_sections(tmp_path, monthly("generated_daily"))
    assert [item.text for item in daily] == ["Covered day.", "Gap day."]


def test_daily_generation_writes_note(
    session_factory: SessionFactory, source: FakeSource, llm: Llm, tmp_path: Path
) -> None:
    run(request())
    note = tmp_path / DAY / "notes" / "Daily activity.md"
    assert note.read_text(encoding="utf-8") == (
        f"# ⚡ Daily activity — {DAY}\n\nCoded the **Activity** page.\n"
    )
    assert "[09:00] push — Pushed 1 commit" in llm.prompts[0]
    with session_factory() as db:
        assert db.get(Project, ACTIVITY_PROJECT) is not None
        assert db.get(ProjectFile, (ACTIVITY_PROJECT, str(note))) is not None
    assert len(llm.prompts) == 1


def test_daily_generation_writes_note_and_time_entries(
    session_factory: SessionFactory,
    catalog: None,
    source: FakeSource,
    llm: Llm,
    tmp_path: Path,
) -> None:
    run(request(outputs=BOTH))
    note = tmp_path / DAY / "notes" / "Daily activity.md"
    assert note.read_text(encoding="utf-8").startswith(f"# ⚡ Daily activity — {DAY}")
    task = ActivityGenerationManager.list_tasks()[0]
    assert task.result == "Generated summary note and 2 time entries."
    with session_factory() as db:
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
    session_factory: SessionFactory, catalog: None, source: FakeSource, llm: Llm, tmp_path: Path
) -> None:
    run(request(outputs=("time",)))
    run(request(outputs=("time",)))
    assert not (tmp_path / DAY).exists()
    with session_factory() as db:
        assert db.query(CalendarRecord).count() == 2
    assert len(llm.prompts) == 2


def test_weekly_and_monthly_generation_write_notes(
    session_factory: SessionFactory, llm: Llm, tmp_path: Path
) -> None:
    write_note(tmp_path, "daily", "2026-11-17", "Tuesday work.")
    run(weekly())
    weekly_note = tmp_path / WEEK / "notes" / "Weekly activity.md"
    assert weekly_note.read_text(encoding="utf-8").startswith(
        "# ⚡ Weekly activity — Week of 2026-11-16"
    )
    assert "Tuesday work." in llm.prompts[0]
    run(monthly())
    monthly_note = tmp_path / MONTH / "notes" / "Monthly activity.md"
    assert monthly_note.read_text(encoding="utf-8").startswith("# ⚡ Monthly activity — 2026-11")
    assert "Coded the **Activity** page." in llm.prompts[1]
    with session_factory() as db:
        assert db.get(ProjectFile, (ACTIVITY_PROJECT, str(monthly_note))) is not None


def test_generated_context_without_summary_fails(
    session_factory: SessionFactory, llm: Llm
) -> None:
    run(weekly())
    assert llm.prompts == []
    task = ActivityGenerationManager.list_tasks()[0]
    assert task.state == TaskStateEnum.FAILED.value
    assert task.result == "No generated summary in this period."


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


BODY = {
    "span": "daily",
    "day": DAY,
    "start": "2026-11-18T23:00:00Z",
    "end": "2026-11-19T23:00:00Z",
    "utc_offset_minutes": OFFSET,
    "basis": "sources",
    "sources": ["github"],
    "instruction": INSTRUCTION,
}


def client() -> TestClient:
    """
    Serve the activity generation routes

    Returns:
        TestClient: client
    """
    app = FastAPI()
    app.include_router(views.activity_generation.router)
    return TestClient(app)


def test_api_queues_and_reads_periods(
    session_factory: SessionFactory, source: FakeSource, llm: Llm, tmp_path: Path
) -> None:
    api = client()
    assert api.get(f"/activity-generation/daily/{DAY}").json()["task"] is None
    assert api.post("/activity-generation/generate", json=BODY).json() == {"key": f"daily/{DAY}"}
    assert api.post("/activity-generation/generate", json=BODY).status_code == 409
    ActivityGenerationManager.handle(f"daily/{DAY}")
    day = api.get(f"/activity-generation/daily/{DAY}").json()
    assert day["task"]["state"] == "COMPLETED"
    assert day["note"]["content"].startswith("# ⚡ Daily activity")
    assert day["records"] == []
    assert INSTRUCTION in llm.prompts[0]
    assert api.get("/activity-generation/tasks").json()[0]["label"] == f"Daily · {DAY}"
    write_note(tmp_path, "weekly", WEEK, "A week.")
    week = api.get(f"/activity-generation/weekly/{WEEK}").json()
    assert week["note"]["content"].endswith("A week.\n")
    assert week["records"] == []
    assert api.get(f"/activity-generation/yearly/{WEEK}").status_code == 422
    assert api.post("/activity-generation/generate", json={**BODY, "sources": []}).status_code == 400


def test_api_generates_and_reads_time_entries(
    session_factory: SessionFactory, catalog: None, source: FakeSource, llm: Llm
) -> None:
    api = client()
    api.post("/activity-generation/generate", json={**BODY, "outputs": list(BOTH)})
    ActivityGenerationManager.handle(f"daily/{DAY}")
    day = api.get(f"/activity-generation/daily/{DAY}").json()
    assert [
        (item["start"], item["title"], item["projects"], item["tags"])
        for item in day["records"]
    ] == [
        ("09:00", "Mail triage", ["Alpha"], ["Deep"]),
        ("14:00", "Activity page", [], []),
    ]
    assert api.post("/activity-generation/generate", json={**BODY, "outputs": []}).status_code == 400
    weekly_time = {
        **BODY,
        "span": "weekly",
        "day": WEEK,
        "start": "2026-11-15T23:00:00Z",
        "end": "2026-11-22T23:00:00Z",
        "basis": "generated",
        "outputs": list(BOTH),
    }
    assert api.post("/activity-generation/generate", json=weekly_time).status_code == 400


def test_api_queues_a_month_from_weekly(session_factory: SessionFactory, llm: Llm) -> None:
    body = {
        **BODY,
        "span": "monthly",
        "day": MONTH,
        "start": "2026-10-31T23:00:00Z",
        "end": "2026-11-30T23:00:00Z",
        "basis": "generated",
        "sources": [],
        "fill_daily": True,
    }
    assert client().post("/activity-generation/generate", json=body).json() == {
        "key": f"monthly/{MONTH}"
    }
    labels = [task["label"] for task in client().get("/activity-generation/tasks").json()]
    assert labels == ["Monthly · 2026-11"]


def test_dry_run_builds_prompt_without_llm(
    session_factory: SessionFactory, source: FakeSource, llm: Llm
) -> None:
    api = client()
    result = api.post("/activity-generation/dry-run", json=BODY).json()
    assert llm.prompts == []
    assert ActivityGenerationManager.list_tasks() == []
    assert "[09:00] push — Pushed 1 commit" in result["prompt"]
    assert INSTRUCTION in result["prompt"]
    assert result["stats"]["characters"] == len(result["prompt"])
    assert result["stats"]["estimated_tokens"] == -(-len(result["prompt"]) // 4)
    github = next(part for part in result["parts"] if part["label"] == "GitHub")
    assert (github["kind"], github["activities"], github["error"]) == ("source", 2, "")
    assert github["stats"]["characters"] > 0
    assert result["context_tokens"] > 0
    bad = {**BODY, "sources": []}
    assert api.post("/activity-generation/dry-run", json=bad).status_code == 400


def test_dry_run_with_time_entries_lists_catalog(
    session_factory: SessionFactory, catalog: None, source: FakeSource, llm: Llm
) -> None:
    body = {**BODY, "outputs": list(BOTH)}
    result = client().post("/activity-generation/dry-run", json=body).json()
    assert llm.prompts == []
    assert SUMMARY_MARKER in result["prompt"] and TIME_MARKER in result["prompt"]
    assert "- Alpha" in result["prompt"] and "- Deep" in result["prompt"]
    kinds = [part["kind"] for part in result["parts"]]
    assert "catalog" in kinds

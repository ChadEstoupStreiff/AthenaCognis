"""Activity generation prompt: one LLM call per request, split answer, dry-run stats."""

import re
from dataclasses import dataclass
from typing import Literal

from controllers.activity.generation import (
    CLOCK_FORMAT,
    DATED_CLOCK_FORMAT,
    SUMMARY_ONLY,
    Basis,
    GenerationRequest,
    Output,
    SourceSection,
    Span,
    SummarySection,
    period_label,
    section_text,
    strip_fence,
)
from controllers.activity.generation_time import Catalog
from tools.prompts import get_prompt, render

# Rough characters per LLM token, for dry-run estimates.
CHARS_PER_TOKEN = 4
PART_SEPARATOR = "\n\n"
INSTRUCTIONS_LABEL = "Instructions"
CATALOG_LABEL = "Projects and tags"
# Name of each output in its task and answer marker line.
OUTPUT_LABELS: dict[Output, str] = {"summary": "SUMMARY", "time": "TIME ENTRIES"}
OUTPUT_MARKERS: dict[Output, str] = {
    output: f"=== {label} ===" for output, label in OUTPUT_LABELS.items()
}
MARKER_OUTPUTS: dict[str, Output] = {label: output for output, label in OUTPUT_LABELS.items()}
# Marker line of the answer, tolerant to spaces, case and the count of "=".
ANSWER_MARKER = re.compile(
    r"^\s*=+\s*(SUMMARY|TIME ENTRIES)\s*=+\s*$", re.IGNORECASE | re.MULTILINE
)
TIME_TASK_KEY = "activity.time_task"
FORMAT_KEYS: dict[Output, str] = {
    "summary": "activity.summary_format",
    "time": "activity.time_format",
}
SPAN_NOUNS: dict[Span, str] = {"daily": "day", "weekly": "week", "monthly": "month"}
TASK_KEYS: dict[Span, str] = {
    "daily": "activity.daily_task",
    "weekly": "activity.weekly_task",
    "monthly": "activity.monthly_task",
}
INTRO_KEYS: dict[Basis, str] = {
    "sources": "activity.sources_intro",
    "generated": "activity.generated_intro",
    "generated_daily": "activity.generated_intro",
}

PartKind = Literal["instructions", "source", "summary", "catalog"]


@dataclass(frozen=True)
class PromptPart:
    """Block of the prompt, measured on its own by the dry run."""

    label: str
    kind: PartKind
    text: str
    # Source blocks: activities read and why the source failed ("" when read).
    activities: int = 0
    error: str = ""


@dataclass(frozen=True)
class Prompt:
    """Prompt asking every output of a request in one LLM call."""

    parts: tuple[PromptPart, ...]

    def text(self) -> str:
        """
        Render the prompt sent to the LLM

        Returns:
            str: parts separated by blank lines
        """
        return PART_SEPARATOR.join(part.text for part in self.parts)


@dataclass(frozen=True)
class PromptStats:
    """Size of a text."""

    characters: int
    words: int
    lines: int
    # Characters / CHARS_PER_TOKEN, rounded up.
    estimated_tokens: int

    @classmethod
    def of(cls, text: str) -> "PromptStats":
        """
        Measure a text

        Args:
            text (str): text
        Returns:
            PromptStats: size
        """
        return cls(
            characters=len(text),
            words=len(text.split()),
            lines=text.count("\n") + 1 if text else 0,
            estimated_tokens=-(-len(text) // CHARS_PER_TOKEN),
        )


@dataclass(frozen=True)
class PartStat:
    """Size of one block of the prompt (instructions, a data source, a summary, the catalog)."""

    label: str
    kind: PartKind
    activities: int
    error: str
    stats: PromptStats


@dataclass(frozen=True)
class DryRun:
    """Prompt a generation would send, without asking the LLM."""

    prompt: str
    stats: PromptStats
    parts: tuple[PartStat, ...]
    # Routed model ("type · model"), "" when unset.
    model: str
    # Context window of the routed model, in tokens.
    context_tokens: int


def instructions(text: str) -> PromptPart:
    """
    Build an instructions block

    Args:
        text (str): text
    Returns:
        PromptPart: block labelled Instructions
    """
    return PromptPart(INSTRUCTIONS_LABEL, "instructions", text)


def source_part(section: SourceSection, utc_offset_minutes: int, clock_format: str) -> PromptPart:
    """
    Build the block of one data source

    Args:
        section (SourceSection): source activities
        utc_offset_minutes (int): local time minus UTC, in minutes
        clock_format (str): strftime format of each activity moment
    Returns:
        PromptPart: source block with its activity count and error
    """
    return PromptPart(
        section.label,
        "source",
        section_text(section, utc_offset_minutes, clock_format),
        len(section.activities),
        section.error,
    )


def summary_part(section: SummarySection) -> PromptPart:
    """
    Build the block of a summary already generated

    Args:
        section (SummarySection): summary
    Returns:
        PromptPart: "### label" block
    """
    return PromptPart(section.label, "summary", f"### {section.label}\n{section.text}")


def catalog_part(catalog: Catalog) -> PromptPart:
    """
    Build the block listing the projects and tags time entries may use

    Args:
        catalog (Catalog): projects and tags
    Returns:
        PromptPart: catalog block
    """
    return PromptPart(CATALOG_LABEL, "catalog", render("activity.catalog", catalog=catalog.text()))


def output_task(span: Span, output: Output) -> str:
    """
    Task prompt of one output

    Args:
        span (Span): time span
        output (Output): output
    Returns:
        str: journal task of the span, or the time entries task
    """
    return get_prompt(TIME_TASK_KEY if output == "time" else TASK_KEYS[span])


def task_blocks(request: GenerationRequest) -> list[str]:
    """
    Render the tasks of the asked outputs

    Args:
        request (GenerationRequest): request
    Returns:
        list[str]: journal task alone, or "Do every task" and one labelled task per output
    """
    if request.outputs == SUMMARY_ONLY:
        return [output_task(request.span, "summary")]
    tasks = [
        f"{OUTPUT_LABELS[output]}: {output_task(request.span, output)}"
        for output in request.outputs
    ]
    return [get_prompt("activity.tasks_intro"), *tasks]


def format_text(outputs: tuple[Output, ...]) -> str:
    """
    Render the answer format of the asked outputs

    Args:
        outputs (tuple[Output, ...]): asked outputs
    Returns:
        str: journal format alone, or the marker line and format of each output
    """
    if outputs == SUMMARY_ONLY:
        return get_prompt("activity.format")
    formats = "\n".join(
        render(FORMAT_KEYS[output], marker=OUTPUT_MARKERS[output]) for output in outputs
    )
    return render("activity.sections_format", formats=formats)


def task_text(request: GenerationRequest) -> str:
    """
    Render the context, tasks, custom instruction and answer format of a request

    Args:
        request (GenerationRequest): request
    Returns:
        str: blocks separated by blank lines (no instruction block when empty)
    """
    noun = SPAN_NOUNS[request.span]
    blocks = [render(INTRO_KEYS[request.basis], span=noun), *task_blocks(request)]
    instruction = request.instruction.strip()
    if instruction:
        blocks.append(render("activity.instruction", instruction=instruction))
    blocks.append(format_text(request.outputs))
    return PART_SEPARATOR.join(blocks)


def build_prompt(
    request: GenerationRequest,
    sources: list[SourceSection],
    summaries: list[SummarySection],
    catalog: Catalog | None = None,
) -> Prompt:
    """
    Build the single prompt asking every output of a period

    Args:
        request (GenerationRequest): request
        sources (list[SourceSection]): source activities (data source context)
        summaries (list[SummarySection]): shorter summaries (generated context)
        catalog (Catalog | None): projects and tags, listed when time entries are asked
    Returns:
        Prompt: activity, catalog when needed, tasks and format
    """
    clock_format = CLOCK_FORMAT if request.span == "daily" else DATED_CLOCK_FORMAT
    noun = SPAN_NOUNS[request.span]
    period = period_label(request.span, request.day)
    parts = [
        instructions(render("activity.period_start", span=noun, period=period)),
        *(source_part(item, request.utc_offset_minutes, clock_format) for item in sources),
        *(summary_part(item) for item in summaries),
        instructions(get_prompt("activity.period_end")),
    ]
    if "time" in request.outputs:
        parts.append(catalog_part(catalog or Catalog()))
    parts.append(instructions(task_text(request)))
    return Prompt(tuple(parts))


def split_answer(answer: str, outputs: tuple[Output, ...]) -> dict[Output, str]:
    """
    Split an LLM answer into the section of each output

    Args:
        answer (str): raw answer, with marker lines when several outputs are asked
        outputs (tuple[Output, ...]): asked outputs
    Returns:
        dict[Output, str]: section text per asked output, fence stripped
    Raises:
        ValueError: an asked section is missing
    """
    found: dict[Output, str] = {}
    markers = list(ANSWER_MARKER.finditer(answer))
    for index, marker in enumerate(markers):
        end = markers[index + 1].start() if index + 1 < len(markers) else len(answer)
        found[MARKER_OUTPUTS[marker.group(1).upper()]] = strip_fence(answer[marker.end() : end])
    if not markers and len(outputs) == 1:
        found[outputs[0]] = strip_fence(answer)
    missing = [output for output in outputs if output not in found]
    if missing:
        raise ValueError(f"Answer misses the section of: {', '.join(missing)}.")
    return {output: found[output] for output in outputs}


def part_stats(prompt: Prompt) -> tuple[PartStat, ...]:
    """
    Measure the prompt per block, instruction blocks merged into one

    Args:
        prompt (Prompt): prompt
    Returns:
        tuple[PartStat, ...]: one row per label, in prompt order
    """
    grouped: dict[str, list[PromptPart]] = {}
    for part in prompt.parts:
        grouped.setdefault(part.label, []).append(part)
    return tuple(
        PartStat(
            label,
            parts[0].kind,
            sum(part.activities for part in parts),
            parts[0].error,
            PromptStats.of(PART_SEPARATOR.join(part.text for part in parts)),
        )
        for label, parts in grouped.items()
    )

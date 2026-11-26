"""Activity generation prompt: one LLM call per summary, dry-run stats."""

from dataclasses import dataclass
from typing import Literal

from controllers.activity.generation import (
    CLOCK_FORMAT,
    DATED_CLOCK_FORMAT,
    Basis,
    GenerationRequest,
    SourceSection,
    Span,
    SummarySection,
    period_label,
    section_text,
)
from tools.prompts import get_prompt, render

# Rough characters per LLM token, for dry-run estimates.
CHARS_PER_TOKEN = 4
PART_SEPARATOR = "\n\n"
INSTRUCTIONS_LABEL = "Instructions"
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

PartKind = Literal["instructions", "source", "summary"]


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
    """Prompt asking one summary."""

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
    """Size of one block of the prompt (instructions, a data source, a summary)."""

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


def task_text(request: GenerationRequest) -> str:
    """
    Render the context, task, custom instruction and answer format of a request

    Args:
        request (GenerationRequest): request
    Returns:
        str: blocks separated by blank lines (no instruction block when empty)
    """
    noun = SPAN_NOUNS[request.span]
    blocks = [render(INTRO_KEYS[request.basis], span=noun), get_prompt(TASK_KEYS[request.span])]
    instruction = request.instruction.strip()
    if instruction:
        blocks.append(render("activity.instruction", instruction=instruction))
    blocks.append(get_prompt("activity.format"))
    return PART_SEPARATOR.join(blocks)


def build_prompt(
    request: GenerationRequest,
    sources: list[SourceSection],
    summaries: list[SummarySection],
) -> Prompt:
    """
    Build the single prompt asking the summary of a period

    Args:
        request (GenerationRequest): request
        sources (list[SourceSection]): source activities (data source context)
        summaries (list[SummarySection]): shorter summaries (generated context)
    Returns:
        Prompt: activity, task and format
    """
    clock_format = CLOCK_FORMAT if request.span == "daily" else DATED_CLOCK_FORMAT
    noun = SPAN_NOUNS[request.span]
    period = period_label(request.span, request.day)
    parts = [
        instructions(render("activity.period_start", span=noun, period=period)),
        *(source_part(item, request.utc_offset_minutes, clock_format) for item in sources),
        *(summary_part(item) for item in summaries),
        instructions(get_prompt("activity.period_end")),
        instructions(task_text(request)),
    ]
    return Prompt(tuple(parts))


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

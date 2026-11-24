"""Activity generation prompt: one LLM call for every output, split answer, dry-run stats."""

import re
from dataclasses import dataclass
from typing import Literal

from controllers.activity.generation import (
    Catalog,
    Output,
    SourceSection,
    section_text,
    strip_fence,
)
from tools.prompts import get_prompt, render

# Rough characters per LLM token, for dry-run estimates.
CHARS_PER_TOKEN = 4
PART_SEPARATOR = "\n\n"
INSTRUCTIONS_LABEL = "Instructions"
CATALOG_LABEL = "Projects and tags"
SUMMARY_MARKER = "=== SUMMARY ==="
TIME_MARKER = "=== TIME ENTRIES ==="
# Marker line of the answer, tolerant to spaces, case and the count of "=".
ANSWER_MARKER = re.compile(
    r"^\s*=+\s*(SUMMARY|TIME ENTRIES)\s*=+\s*$", re.IGNORECASE | re.MULTILINE
)
MARKER_OUTPUTS: dict[str, Output] = {"SUMMARY": "summary", "TIME ENTRIES": "time"}

TASK_KEYS: dict[Output, str] = {"summary": "activity.summary_task", "time": "activity.time_task"}
FORMAT_KEYS: dict[Output, str] = {
    "summary": "activity.summary_format",
    "time": "activity.time_format",
}
OUTPUT_MARKERS: dict[Output, str] = {"summary": SUMMARY_MARKER, "time": TIME_MARKER}

PartKind = Literal["instructions", "source", "catalog"]


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
    """Prompt asking every output in one LLM call."""

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
    """Size of one block of the prompt (instructions, a data source, the catalog)."""

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


def source_part(section: SourceSection, utc_offset_minutes: int) -> PromptPart:
    """
    Build the block of one data source

    Args:
        section (SourceSection): source activities
        utc_offset_minutes (int): local time minus UTC, in minutes
    Returns:
        PromptPart: source block with its activity count and error
    """
    return PromptPart(
        section.label,
        "source",
        section_text(section, utc_offset_minutes),
        len(section.activities),
        section.error,
    )


def task_text(outputs: tuple[Output, ...]) -> str:
    """
    Render the tasks and the answer format of the asked outputs

    Args:
        outputs (tuple[Output, ...]): asked outputs
    Returns:
        str: TASK and FORMAT blocks
    """
    tasks = "\n\n".join(get_prompt(TASK_KEYS[output]) for output in outputs)
    formats = "\n".join(
        render(FORMAT_KEYS[output], marker=OUTPUT_MARKERS[output]) for output in outputs
    )
    return render("activity.task", tasks=tasks, formats=formats)


def build_prompt(
    day: str,
    sections: list[SourceSection],
    outputs: tuple[Output, ...],
    catalog: Catalog,
    utc_offset_minutes: int,
) -> Prompt:
    """
    Build the single prompt asking every output of a day

    Args:
        day (str): "YYYY-MM-DD"
        sections (list[SourceSection]): source activities
        outputs (tuple[Output, ...]): asked outputs
        catalog (Catalog): projects and tags (listed only for time entries)
        utc_offset_minutes (int): local time minus UTC, in minutes
    Returns:
        Prompt: activity, catalog when needed, tasks and format
    """
    parts = [
        instructions(render("activity.day_start", day=day)),
        *(source_part(section, utc_offset_minutes) for section in sections),
        instructions(render("activity.day_end", day=day)),
    ]
    if "time" in outputs:
        parts.append(
            PromptPart(CATALOG_LABEL, "catalog", render("activity.catalog", catalog=catalog.text()))
        )
    parts.append(instructions(task_text(outputs)))
    return Prompt(tuple(parts))


def split_answer(answer: str, outputs: tuple[Output, ...]) -> dict[Output, str]:
    """
    Split an LLM answer into the section of each output

    Args:
        answer (str): raw answer with marker lines
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

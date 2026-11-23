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

SUMMARY_TASK = """SUMMARY: write the end-of-day journal of the user from the activity above.
Group related items, name projects, people and outcomes, skip noise.
Sections: a 2-3 sentence overview, then "## Highlights" (bullets), then "## Details" per theme.
Maximum 400 words."""

TIME_TASK = """TIME ENTRIES: turn the activity above into the time entries of the user's day.
Be detailed: one block per distinct task (feature, bug, meeting, review, mail thread, writing),
split a long period when the work changes; merge only items of the same task; minimum 15 minutes.
Title names the concrete task; description gives 1-3 sentences of specifics
(files, repos, PRs, documents, people, decisions, outcomes) taken from the activity.
Build a complete working day from the first to the last activity:
fill every gap between blocks by extending the neighbouring block of the most related task,
or by a block for the likely work in between (inferred from the activity before and after).
Never cover meal breaks 12:00-13:00 and 19:00-20:00 (shift them by up to 30 minutes
when a meeting or activity overlaps them), unless the activity shows work there.
Blocks must not overlap. Give each block the projects and tags it belongs to,
chosen ONLY from the lists above (exact names, several allowed, empty list when none fits)."""

SUMMARY_FORMAT = f"""{SUMMARY_MARKER}
markdown, no title line, no code fence"""

TIME_FORMAT = f"""{TIME_MARKER}
JSON array only, no code fence:
[{{"start": "HH:MM", "end": "HH:MM", "title": "concrete task", "description": "1-3 sentences of specifics",
  "projects": ["Project name"], "tags": ["Tag name"]}}]"""

TASKS: dict[Output, str] = {"summary": SUMMARY_TASK, "time": TIME_TASK}
FORMATS: dict[Output, str] = {"summary": SUMMARY_FORMAT, "time": TIME_FORMAT}

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
    tasks = "\n\n".join(TASKS[output] for output in outputs)
    formats = "\n".join(FORMATS[output] for output in outputs)
    return (
        f"! TASK !\nTimes above are local. Do every task below.\n\n{tasks}\n\n"
        f"! FORMAT !\nRespond ONLY with these sections, in this order, "
        f"each starting with its marker line:\n{formats}"
    )


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
        instructions(f"! ACTIVITY OF {day} START !"),
        *(source_part(section, utc_offset_minutes) for section in sections),
        instructions(f"! ACTIVITY OF {day} END !"),
    ]
    if "time" in outputs:
        parts.append(
            PromptPart(CATALOG_LABEL, "catalog", f"! PROJECTS AND TAGS !\n{catalog.text()}")
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

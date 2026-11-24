"""Prompt templates of every LLM call, read from prompts.yaml at the repository root."""

import logging
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Union

import yaml

PROMPTS_FILE_NAME = "prompts.yaml"
PROMPTS_PATH_ENV = "PROMPTS_PATH"
KEY_SEPARATOR = "."
# {name} placeholder; JSON braces like {"a": 1} never match.
PLACEHOLDER = re.compile(r"\{(\w+)\}")

PlaceholderValue = Union[str, int, float]

logger = logging.getLogger(__name__)


class PromptsError(Exception):
    """Raised when the prompts file is missing, malformed or lacks a prompt."""


@dataclass(frozen=True)
class _LoadedPrompts:
    """Prompts of one version of the file."""

    path: Path
    modified_at: float
    prompts: Dict[str, str]


_cache: Optional[_LoadedPrompts] = None
_cache_lock = threading.Lock()


def find_prompts_file() -> Path:
    """
    Locate prompts.yaml: PROMPTS_PATH, else the first parent folder holding it

    Returns:
        Path: prompts file
    Raises:
        PromptsError: when no prompts file is found
    """
    override = os.environ.get(PROMPTS_PATH_ENV)
    if override:
        return Path(override)
    for folder in Path(__file__).resolve().parents:
        candidate = folder / PROMPTS_FILE_NAME
        if candidate.is_file():
            return candidate
    raise PromptsError(f"{PROMPTS_FILE_NAME} not found above {Path(__file__).parent}.")


def flatten(tree: Dict[object, object], prefix: str = "") -> Dict[str, str]:
    """
    Flatten nested prompt groups into dotted keys ("mail.summary")

    Args:
        tree (Dict[object, object]): parsed YAML mapping
        prefix (str): key of the parent group
    Returns:
        Dict[str, str]: prompt text per dotted key
    Raises:
        PromptsError: when a value is neither a group nor a text
    """
    prompts: Dict[str, str] = {}
    for name, value in tree.items():
        key = f"{prefix}{name}"
        if isinstance(value, dict):
            prompts.update(flatten(value, f"{key}{KEY_SEPARATOR}"))
        elif isinstance(value, str):
            prompts[key] = value
        else:
            raise PromptsError(f"Prompt '{key}' must be a text or a group, got {type(value).__name__}.")
    return prompts


def load_prompts(path: Path) -> Dict[str, str]:
    """
    Read and validate a prompts file

    Args:
        path (Path): prompts file
    Returns:
        Dict[str, str]: prompt text per dotted key
    Raises:
        PromptsError: when the file cannot be read or is not a YAML mapping
    """
    try:
        with path.open(encoding="utf-8") as stream:
            tree = yaml.safe_load(stream)
    except (OSError, yaml.YAMLError) as error:
        raise PromptsError(f"Cannot read {path}: {error}") from error
    if not isinstance(tree, dict):
        raise PromptsError(f"{path} must be a YAML mapping of prompts.")
    return flatten(tree)


def all_prompts() -> Dict[str, str]:
    """
    Return every prompt, re-reading the file when it changed

    Returns:
        Dict[str, str]: prompt text per dotted key
    Raises:
        PromptsError: when the file is missing or malformed
    """
    global _cache
    path = find_prompts_file()
    try:
        modified_at = path.stat().st_mtime
    except OSError as error:
        raise PromptsError(f"Cannot read {path}: {error}") from error
    with _cache_lock:
        if _cache is None or _cache.path != path or _cache.modified_at != modified_at:
            _cache = _LoadedPrompts(path, modified_at, load_prompts(path))
            logger.info(f"Loaded {len(_cache.prompts)} prompts from {path}")
        return _cache.prompts


def get_prompt(key: str) -> str:
    """
    Return one prompt as written in the file

    Args:
        key (str): dotted key ("mail.summary")
    Returns:
        str: prompt text
    Raises:
        PromptsError: when the prompt is missing
    """
    prompts = all_prompts()
    if key not in prompts:
        raise PromptsError(f"Prompt '{key}' missing from {find_prompts_file()}.")
    return prompts[key]


def fill(template: str, values: Dict[str, PlaceholderValue]) -> str:
    """
    Replace the {name} placeholders of a template, unknown ones left as written

    Args:
        template (str): text with placeholders
        values (Dict[str, PlaceholderValue]): value per placeholder name
    Returns:
        str: filled text (values themselves never re-scanned)
    """
    return PLACEHOLDER.sub(
        lambda match: str(values[match.group(1)]) if match.group(1) in values else match.group(0),
        template,
    )


def render(key: str, **values: PlaceholderValue) -> str:
    """
    Return one prompt with its placeholders filled

    Args:
        key (str): dotted key ("mail.summary")
        **values (PlaceholderValue): value per placeholder name
    Returns:
        str: prompt text
    Raises:
        PromptsError: when the prompt is missing
    """
    return fill(get_prompt(key), values)

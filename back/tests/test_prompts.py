import os
import re
from pathlib import Path

import pytest

from tools import prompts
from tools.prompts import PromptsError, fill, flatten, get_prompt, load_prompts, render

SOURCE_DIR = Path(__file__).resolve().parents[1] / "src"
PROMPT_KEY_USE = re.compile(r"""(?:get_prompt|render)\(\s*"([\w.]+)\"""")
KEY_CONSTANT = re.compile(r""""((?:style|chat|summarize|tree|ocr|research|link|refractor|mail|activity)\.\w+)\"""")


@pytest.fixture
def prompts_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """
    Point the loader to a temporary prompts file

    Args:
        tmp_path (Path): pytest temporary folder
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Path: prompts file to write
    """
    path = tmp_path / "prompts.yaml"
    monkeypatch.setenv(prompts.PROMPTS_PATH_ENV, str(path))
    monkeypatch.setattr(prompts, "_cache", None)
    return path


def test_fill_replaces_known_placeholders_only() -> None:
    """
    Keep JSON braces and unknown placeholders, replace the given ones
    """
    template = 'Hi {name}, {input}\n{"title": "{name}"}'
    assert fill(template, {"name": "Ada"}) == 'Hi Ada, {input}\n{"title": "Ada"}'


def test_fill_never_rescans_values() -> None:
    """
    Leave placeholders found inside values untouched
    """
    assert fill("{a} {b}", {"a": "{b}", "b": "x"}) == "{b} x"


def test_flatten_builds_dotted_keys() -> None:
    """
    Join nested group names with dots
    """
    assert flatten({"mail": {"summary": "s", "sub": {"x": "y"}}, "top": "t"}) == {
        "mail.summary": "s",
        "mail.sub.x": "y",
        "top": "t",
    }


def test_flatten_rejects_non_text() -> None:
    """
    Refuse values that are neither a text nor a group
    """
    with pytest.raises(PromptsError, match="mail.limit"):
        flatten({"mail": {"limit": 3}})


def test_load_rejects_non_mapping(prompts_file: Path) -> None:
    """
    Refuse a file that is not a YAML mapping
    """
    prompts_file.write_text("- a\n- b\n", encoding="utf-8")
    with pytest.raises(PromptsError, match="mapping"):
        load_prompts(prompts_file)


def test_render_and_missing_key(prompts_file: Path) -> None:
    """
    Render a prompt from the file and fail clearly on a missing one
    """
    prompts_file.write_text("greet:\n  hello: |-\n    Hello {who}\n", encoding="utf-8")
    assert render("greet.hello", who="you") == "Hello you"
    with pytest.raises(PromptsError, match="greet.bye"):
        get_prompt("greet.bye")


def test_reload_on_change(prompts_file: Path) -> None:
    """
    Re-read the file when its modification time changes
    """
    prompts_file.write_text("a: one\n", encoding="utf-8")
    assert get_prompt("a") == "one"
    prompts_file.write_text("a: two\n", encoding="utf-8")
    stat = prompts_file.stat()
    os.utime(prompts_file, (stat.st_atime, stat.st_mtime + 1))
    assert get_prompt("a") == "two"


def test_every_used_key_exists_in_repository_file() -> None:
    """
    Find every prompt key referenced by the backend in the real prompts.yaml
    """
    sources = [path.read_text(encoding="utf-8") for path in SOURCE_DIR.rglob("*.py")]
    used = {key for text in sources for key in PROMPT_KEY_USE.findall(text)}
    used |= {key for text in sources for key in KEY_CONSTANT.findall(text)}
    available = load_prompts(prompts.find_prompts_file())
    assert used, "no prompt key found in the sources"
    assert sorted(used - available.keys()) == []

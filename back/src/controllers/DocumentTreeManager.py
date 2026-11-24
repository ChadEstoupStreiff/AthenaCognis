import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Sequence, TypedDict, Union

from sqlalchemy.orm import Session

from controllers.JobManager import JobManager
from db import DocumentTree, DocumentTreeTask, JobTask, TaskStateEnum, get_db
from tools.ai import request_llm
from tools.prompts import get_prompt, render
from utils import read_text
from views.settings import get_setting

logger = logging.getLogger(__name__)

SETTING_PREFIX = "tree"
FALLBACK_SETTING_PREFIX = "summarization"
CODE_FENCE = "```"

DEPTH_LIMITS = (1, 5)
SECTIONS_LIMITS = (2, 10)
MIN_WORDS_LIMITS = (50, 5000)
FOCUS_MAX_CHARS = 300
DEFAULT_MAX_DEPTH = 3
DEFAULT_MAX_SECTIONS = 5
DEFAULT_MIN_WORDS = 300

MAX_BLOCK_CHARS = 1000
MIN_BLOCKS_TO_SPLIT = 2
TITLE_MAX_CHARS = 120
DESCRIPTION_MAX_CHARS = 400
HEADING_MAX_CHARS = 80
HEADING_PATTERN = re.compile(
    r"^\s*((\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z]"
    r"|(abstract|introduction|background|related work|methods?|methodology|results"
    r"|discussion|conclusions?|references|bibliography|acknowledg(e)?ments|appendix)\b)",
    re.IGNORECASE,
)
PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


class TreeInputError(Exception):
    """Raised when a file has no text to build a tree from."""


class TreeParamsError(ValueError):
    """Raised when tree parameters are out of bounds."""


@dataclass(frozen=True)
class TreeParams:
    """User parameters of a tree generation."""

    max_depth: int = DEFAULT_MAX_DEPTH
    max_sections: int = DEFAULT_MAX_SECTIONS
    min_words: int = DEFAULT_MIN_WORDS
    focus: str = ""
    auto_depth: bool = True
    auto_sections: bool = True

    def __post_init__(self) -> None:
        """
        Validate the parameter bounds

        Returns:
            None
        Raises:
            TreeParamsError: when a value is out of bounds
        """
        check_bounds("max_depth", self.max_depth, DEPTH_LIMITS)
        check_bounds("max_sections", self.max_sections, SECTIONS_LIMITS)
        check_bounds("min_words", self.min_words, MIN_WORDS_LIMITS)
        if len(self.focus) > FOCUS_MAX_CHARS:
            raise TreeParamsError(f"focus must be at most {FOCUS_MAX_CHARS} characters")

    @property
    def depth_limit(self) -> int:
        """
        Get the deepest level allowed (hard cap in auto mode, the AI stops earlier)

        Returns:
            int: maximum depth
        """
        return DEPTH_LIMITS[1] if self.auto_depth else self.max_depth

    @property
    def sections_limit(self) -> int:
        """
        Get the most sections kept per level (hard cap in auto mode)

        Returns:
            int: maximum sections per level
        """
        return SECTIONS_LIMITS[1] if self.auto_sections else self.max_sections


@dataclass
class TreeNode:
    """One section of the tree; range in 1-based inclusive block numbers."""

    section_id: str
    title: str
    description: str
    start: int
    end: int
    sections: List["TreeNode"] = field(default_factory=list)


@dataclass(frozen=True)
class SectionDraft:
    """Section proposed by the LLM, before range normalization."""

    title: str
    description: str
    start: int


TreeJson = Dict[str, Union[str, List[int], List["TreeJson"]]]


class TreeRecord(TypedDict):
    """Stored tree of a file."""

    file: str
    date: datetime
    params: Dict[str, Union[int, str]]
    block_count: int
    tree: List[TreeJson]


class DocumentBlocks(TypedDict):
    """Every block of a document, the targets of the tree ranges."""

    block_count: int
    blocks: List[str]


def check_bounds(name: str, value: int, limits: Sequence[int]) -> None:
    """
    Check an integer parameter lies within inclusive bounds

    Args:
        name (str): parameter name
        value (int): value
        limits (Sequence[int]): (minimum, maximum)
    Returns:
        None
    Raises:
        TreeParamsError: when out of bounds
    """
    low, high = limits
    if not low <= value <= high:
        raise TreeParamsError(f"{name} must be between {low} and {high}, got {value}")


# MARK: Blocks


def is_heading(line: str) -> bool:
    """
    Tell whether a line looks like a section heading

    Args:
        line (str): text line
    Returns:
        bool: True for short numbered or well-known headings
    """
    return len(line.strip()) <= HEADING_MAX_CHARS and HEADING_PATTERN.match(line) is not None


def pack_lines(paragraph: str) -> List[str]:
    """
    Cut a long paragraph into blocks at line boundaries and before headings

    Args:
        paragraph (str): paragraph text
    Returns:
        List[str]: blocks of at most ~MAX_BLOCK_CHARS characters
    """
    blocks: List[str] = []
    current: List[str] = []
    size = 0
    for line in paragraph.splitlines():
        if current and (size + len(line) > MAX_BLOCK_CHARS or is_heading(line)):
            blocks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        blocks.append("\n".join(current))
    return blocks


def split_blocks(text: str) -> List[str]:
    """
    Split a text into numbered-able blocks (paragraphs, long ones packed by lines)

    Args:
        text (str): document text
    Returns:
        List[str]: non-empty blocks in document order
    """
    blocks: List[str] = []
    for paragraph in PARAGRAPH_SPLIT.split(text):
        blocks.extend(block.strip() for block in pack_lines(paragraph.strip()))
    return [block for block in blocks if block]


def number_blocks(blocks: Sequence[str], start: int, end: int) -> str:
    """
    Render a block range prefixed with block numbers

    Args:
        blocks (Sequence[str]): every block of the document
        start (int): first block, 1-based
        end (int): last block, 1-based inclusive
    Returns:
        str: "[n] text" lines separated by blank lines
    """
    return "\n\n".join(f"[{number}] {blocks[number - 1]}" for number in range(start, end + 1))


def word_count(blocks: Sequence[str], start: int, end: int) -> int:
    """
    Count the words of a block range

    Args:
        blocks (Sequence[str]): every block of the document
        start (int): first block, 1-based
        end (int): last block, 1-based inclusive
    Returns:
        int: number of words
    """
    return sum(len(blocks[number - 1].split()) for number in range(start, end + 1))


# MARK: LLM answer


def extract_json_array(raw: str) -> List[object]:
    """
    Parse the JSON array of an LLM answer, tolerating fences and surrounding text

    Args:
        raw (str): LLM answer
    Returns:
        List[object]: parsed items
    Raises:
        ValueError: when no JSON array can be parsed
        TypeError: when the parsed JSON is not an array
    """
    text = raw.strip().removeprefix(CODE_FENCE + "json").strip(CODE_FENCE).strip()
    first, last = text.find("["), text.rfind("]")
    if first == -1 or last <= first:
        raise ValueError(f"No JSON array in LLM answer: {raw[:200]!r}")
    parsed = json.loads(text[first : last + 1])
    if not isinstance(parsed, list):
        raise TypeError("LLM answer is not a JSON array")
    return parsed


def to_draft(item: object) -> Optional[SectionDraft]:
    """
    Convert one LLM item into a section draft

    Args:
        item (object): parsed JSON item
    Returns:
        Optional[SectionDraft]: draft, None when the item is unusable
    """
    if not isinstance(item, dict):
        return None
    try:
        start = int(item["start"])
    except (KeyError, TypeError, ValueError):
        return None
    title = str(item.get("title") or "Untitled").strip()[:TITLE_MAX_CHARS]
    description = str(item.get("description") or "").strip()[:DESCRIPTION_MAX_CHARS]
    return SectionDraft(title=title, description=description, start=start)


def normalize_sections(
    items: Sequence[object], start: int, end: int
) -> List[SectionDraft]:
    """
    Turn LLM items into ordered, non-overlapping drafts starting inside the range

    Starts are trusted, ends are derived from the next start: the drafts cover the
    whole range without gap or overlap.

    Args:
        items (Sequence[object]): parsed LLM items
        start (int): range first block
        end (int): range last block
    Returns:
        List[SectionDraft]: drafts sorted by distinct start, first one at range start
    """
    drafts = [draft for draft in map(to_draft, items) if draft is not None]
    by_start: Dict[int, SectionDraft] = {}
    for draft in sorted(drafts, key=lambda candidate: candidate.start):
        clamped = min(max(draft.start, start), end)
        by_start.setdefault(clamped, SectionDraft(draft.title, draft.description, clamped))
    ordered = list(by_start.values())
    if ordered and ordered[0].start != start:
        first = ordered[0]
        ordered[0] = SectionDraft(first.title, first.description, start)
    return ordered


def range_ends(drafts: Sequence[SectionDraft], end: int) -> List[int]:
    """
    Compute the last block of each draft from the next draft start

    Args:
        drafts (Sequence[SectionDraft]): ordered drafts
        end (int): range last block
    Returns:
        List[int]: last block of each draft
    """
    return [following.start - 1 for following in drafts[1:]] + [end]


# MARK: Manager


class DocumentTreeManager(JobManager):
    """Build a hierarchical section tree of a document with the LLM."""

    name = "TREE"
    task_model = DocumentTreeTask

    @classmethod
    def new_task(cls, file: str, payload: Optional[str]) -> JobTask:
        """
        Create a pending tree task keeping its parameters

        Args:
            file (str): file path
            payload (Optional[str]): JSON parameters
        Returns:
            JobTask: pending task
        """
        return DocumentTreeTask(
            file=file, added=datetime.now(), state=TaskStateEnum.PENDING, params=payload
        )

    @classmethod
    def request(cls, file: str, params: TreeParams) -> None:
        """
        Queue a tree generation with its parameters

        Args:
            file (str): file path
            params (TreeParams): generation parameters
        Returns:
            None
        Raises:
            JobAlreadyQueuedError: when the file already has an open task
        """
        cls.add_file_to_queue(file, json.dumps(asdict(params)))

    @classmethod
    def running_params(cls, db: Session, file: str) -> TreeParams:
        """
        Read the parameters of the running task of a file

        Args:
            db (Session): session
            file (str): file path
        Returns:
            TreeParams: parameters, defaults when absent
        """
        task = (
            db.query(DocumentTreeTask)
            .filter(
                DocumentTreeTask.file == file,
                DocumentTreeTask.state == TaskStateEnum.IN_PROGRESS,
            )
            .order_by(DocumentTreeTask.added.desc())
            .first()
        )
        if task is None or not task.params:
            return TreeParams()
        return TreeParams(**json.loads(task.params))

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Build the tree of a file and store it

        Args:
            file (str): file path
            db (Session): session committed with the task completion
        Returns:
            str: short result stored on the task
        Raises:
            TreeInputError: when the file has no readable text
        """
        text = read_text(file)
        blocks = split_blocks(text or "")
        if not blocks:
            raise TreeInputError(
                "No readable text: only text, PDF and Word files, or images and media "
                "after OCR / transcription, can be split into a tree."
            )
        params = cls.running_params(db, file)
        tree = cls.build_level(blocks, params, 1, len(blocks), [], "")
        db.query(DocumentTree).filter(DocumentTree.file == file).delete()
        db.add(
            DocumentTree(
                file=file,
                date=datetime.now(),
                params=json.dumps(asdict(params)),
                block_count=len(blocks),
                tree=json.dumps([to_json(node) for node in tree]),
            )
        )
        return f"{count_nodes(tree)} sections over {len(blocks)} blocks"

    @classmethod
    def should_split(
        cls, blocks: Sequence[str], params: TreeParams, start: int, end: int, depth: int
    ) -> bool:
        """
        Tell whether a block range deserves another level of sections

        Args:
            blocks (Sequence[str]): every block of the document
            params (TreeParams): generation parameters
            start (int): range first block
            end (int): range last block
            depth (int): level to generate, 1 = top
        Returns:
            bool: True when the range is deep-enough-allowed and long enough
        """
        if depth > params.depth_limit or end - start + 1 < MIN_BLOCKS_TO_SPLIT:
            return False
        return depth == 1 or word_count(blocks, start, end) >= params.min_words

    @classmethod
    def build_level(
        cls,
        blocks: Sequence[str],
        params: TreeParams,
        start: int,
        end: int,
        path: List[str],
        id_prefix: str,
    ) -> List[TreeNode]:
        """
        Split a block range into sections, then recurse into each section

        Args:
            blocks (Sequence[str]): every block of the document
            params (TreeParams): generation parameters
            start (int): range first block
            end (int): range last block
            path (List[str]): titles of the ancestor sections
            id_prefix (str): section id of the parent ("" at top level)
        Returns:
            List[TreeNode]: sections, empty when the range stays a leaf
        """
        depth = len(path) + 1
        if not cls.should_split(blocks, params, start, end, depth):
            return []
        drafts = cls.draft_sections(blocks, params, start, end, path)
        if depth > 1 and len(drafts) < MIN_BLOCKS_TO_SPLIT:
            return []
        nodes: List[TreeNode] = []
        for index, (draft, last) in enumerate(zip(drafts, range_ends(drafts, end)), 1):
            section_id = f"{id_prefix}{index}"
            children = cls.build_level(
                blocks, params, draft.start, last, [*path, draft.title], f"{section_id}."
            )
            nodes.append(
                TreeNode(section_id, draft.title, draft.description, draft.start, last, children)
            )
        return nodes

    @classmethod
    def draft_sections(
        cls,
        blocks: Sequence[str],
        params: TreeParams,
        start: int,
        end: int,
        path: List[str],
    ) -> List[SectionDraft]:
        """
        Ask the LLM to split a block range; malformed answers below the top make a leaf

        Args:
            blocks (Sequence[str]): every block of the document
            params (TreeParams): generation parameters
            start (int): range first block
            end (int): range last block
            path (List[str]): titles of the ancestor sections
        Returns:
            List[SectionDraft]: normalized drafts
        Raises:
            ValueError: when the top-level answer has no JSON array
            TypeError: when the top-level answer JSON is not an array
        """
        prompt = build_prompt(params, start, end, path)
        _, _, answer = request_llm(
            setting_prefix=routing_prefix(),
            prompt=prompt,
            input_text=number_blocks(blocks, start, end),
        )
        try:
            drafts = normalize_sections(extract_json_array(answer), start, end)
            return drafts[: params.sections_limit]
        except (ValueError, TypeError):
            if not path:
                raise
            logger.warning(f"TREE >> Malformed answer for {' > '.join(path)}, kept as leaf.")
            return []

    @classmethod
    def delete_results(cls, db: Session, file: str) -> None:
        """
        Delete the tree of a file

        Args:
            db (Session): session
            file (str): file path
        Returns:
            None
        """
        db.query(DocumentTree).filter(DocumentTree.file == file).delete()

    @classmethod
    def move_results(cls, db: Session, file: str, new_file: str) -> None:
        """
        Re-point the tree of a file to its new path

        Args:
            db (Session): session
            file (str): old file path
            new_file (str): new file path
        Returns:
            None
        """
        db.query(DocumentTree).filter(DocumentTree.file == file).update(
            {DocumentTree.file: new_file}
        )

    @classmethod
    def get(cls, file: str) -> Optional[TreeRecord]:
        """
        Get the stored tree of a file

        Args:
            file (str): file path
        Returns:
            Optional[TreeRecord]: tree, None when absent
        """
        with get_db() as db:
            row = db.query(DocumentTree).filter(DocumentTree.file == file).first()
            if row is None:
                return None
            return TreeRecord(
                file=row.file,
                date=row.date,
                params=json.loads(row.params),
                block_count=row.block_count,
                tree=json.loads(row.tree),
            )

    @classmethod
    def blocks(cls, file: str) -> DocumentBlocks:
        """
        Read every block of a file (range n = blocks[n - 1])

        Args:
            file (str): file path
        Returns:
            DocumentBlocks: blocks and their count
        Raises:
            TreeInputError: when the file has no readable text
        """
        blocks = split_blocks(read_text(file) or "")
        if not blocks:
            raise TreeInputError("No readable text in this file.")
        return DocumentBlocks(block_count=len(blocks), blocks=blocks)


def routing_prefix() -> str:
    """
    Get the settings prefix routing tree requests (summaries until tree routing is set)

    Returns:
        str: "tree" when tree_type is set, "summarization" otherwise
    """
    return SETTING_PREFIX if get_setting(f"{SETTING_PREFIX}_type") else FALLBACK_SETTING_PREFIX


def build_prompt(params: TreeParams, start: int, end: int, path: List[str]) -> str:
    """
    Build the sectioning prompt of a block range ({input} left for the blocks)

    Args:
        params (TreeParams): generation parameters
        start (int): range first block
        end (int): range last block
        path (List[str]): titles of the ancestor sections
    Returns:
        str: prompt
    """
    count_rule_key = "tree.auto_count_rule" if params.auto_sections else "tree.fixed_count_rule"
    return render(
        "tree.sections",
        start=start,
        end=end,
        count_rule=render(
            count_rule_key, min_sections=MIN_BLOCKS_TO_SPLIT, max_sections=params.sections_limit
        ),
        stop_rule=get_prompt("tree.auto_stop_rule") if params.auto_depth and path else "",
        context=render("tree.context_line", path=" > ".join(path)) if path else "",
        focus=render("tree.focus_line", focus=params.focus) if params.focus else "",
    )


def to_json(node: TreeNode) -> TreeJson:
    """
    Convert a node into the exported JSON shape

    Args:
        node (TreeNode): section
    Returns:
        TreeJson: {section_id, Title, Description, sections, paper_section_range}
    """
    return {
        "section_id": node.section_id,
        "Title": node.title,
        "Description": node.description,
        "sections": [to_json(child) for child in node.sections],
        "paper_section_range": [node.start, node.end],
    }


def count_nodes(nodes: Sequence[TreeNode]) -> int:
    """
    Count the sections of a tree, every level included

    Args:
        nodes (Sequence[TreeNode]): top sections
    Returns:
        int: number of sections
    """
    return sum(1 + count_nodes(node.sections) for node in nodes)

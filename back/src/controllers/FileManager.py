import logging
import os
import re
from datetime import datetime
from typing import Dict, Iterator, List, Literal, Optional, Tuple, Union

from controllers.NoteManager import NoteManager
from controllers.SummarizeManager import SummarizeManager
from db import get_db
from db.models import ProjectFile, TagFile
from tqdm import tqdm
from utils import guess_mime, read_content
from views.settings import get_setting
from whoosh import writing
from whoosh.fields import ID, NGRAM, Schema
from whoosh.index import create_in
from whoosh.qparser import MultifieldParser, OrGroup
from whoosh.query import Every

SPECIAL_CHARACTERS = re.compile(r"[^a-zA-Z0-9\s]")
NON_ALPHANUMERIC_LOWER = re.compile(r"[^a-z0-9\s]")
WHITESPACE_RUN = re.compile(r"\s+")

SearchEngine = Literal["contains", "fuzzy", "semantic"]
SearchEvent = Dict[str, Union[str, int]]
SEARCH_ENGINE_CONTAINS: SearchEngine = "contains"
SEARCH_ENGINE_FUZZY: SearchEngine = "fuzzy"
SEARCH_ENGINE_SEMANTIC: SearchEngine = "semantic"
FUZZY_FIELDS = ["file_name", "keywords", "summary", "note", "content"]
SEARCH_MODE_QUICK = 0
SEARCH_MODE_DEEP = 2


def fold_text(text: str, normalize: bool) -> str:
    """
    Lowercase text, collapse whitespace and optionally strip special characters

    Args:
        text (str): raw text
        normalize (bool): strip special characters
    Returns:
        str: folded text with single spaces between words
    """
    lowered = text.lower()
    if normalize:
        lowered = NON_ALPHANUMERIC_LOWER.sub("", lowered)
    return WHITESPACE_RUN.sub(" ", lowered).strip()


def build_query_phrase(text: Optional[str], exact: bool) -> Tuple[str, bool]:
    """
    Build the phrase a file must contain to match a search text

    Args:
        text (Optional[str]): search text
        exact (bool): keep special characters even when the text has none
    Returns:
        Tuple[str, bool]: phrase (empty matches every file) and whether
            haystacks must be normalized
    """
    stripped = (text or "").strip()
    if not stripped:
        return "", False
    # Without special characters in the query, strip them from both sides
    # so "UNet paper" matches "U-net paper", "u_net paper", etc.
    normalize = not exact and not SPECIAL_CHARACTERS.search(stripped)
    return fold_text(stripped, normalize), normalize


def progress_event(current: int, total: int, file: str) -> SearchEvent:
    """
    Build a search progress event

    Args:
        current (int): 1-based position of the file
        total (int): number of files
        file (str): file path
    Returns:
        SearchEvent: progress event
    """
    return {
        "type": "progress",
        "current": current,
        "total": total,
        "file": os.path.basename(file),
    }


def file_haystack(file: str, search_mode: int, normalize: bool) -> str:
    """
    Gather the searchable text of a file for a search depth

    Args:
        file (str): file path
        search_mode (int): 0 quick, 1 normal (+ summary), 2 deep (+ content)
        normalize (bool): strip special characters
    Returns:
        str: folded text of name, keywords, summary, content and note
    """
    summary_keywords = SummarizeManager.get(file) or {}
    note = NoteManager.get(file)
    parts = [os.path.basename(file), ",".join(summary_keywords.get("keywords", []))]
    if search_mode != SEARCH_MODE_QUICK:
        parts.append(summary_keywords.get("summary", ""))
    if search_mode == SEARCH_MODE_DEEP:
        parts.append(read_content(file, force_read=True) or "")
    parts.append(note.get("note", "") if note else "")
    combined = " ".join(part for part in parts if part)
    return fold_text(combined, normalize)


def index_document(file: str, search_mode: int) -> Dict[str, str]:
    """
    Build the full-text index fields of a file for a search depth

    Args:
        file (str): file path
        search_mode (int): 0 quick, 1 normal (+ summary), 2 deep (+ content)
    Returns:
        Dict[str, str]: index fields
    """
    summary_keywords = SummarizeManager.get(file) or {}
    note = NoteManager.get(file)
    summary = (
        summary_keywords.get("summary", "") if search_mode != SEARCH_MODE_QUICK else ""
    )
    content = (
        read_content(file, force_read=True) if search_mode == SEARCH_MODE_DEEP else ""
    )
    return {
        "file": file,
        "file_name": os.path.basename(file),
        "keywords": ",".join(summary_keywords.get("keywords", [])),
        "summary": summary or "",
        "note": note.get("note", "") if note else "",
        "content": content or "",
    }


def stream_semantic(
    text: str, files: List[str], similarity_threshold: float
) -> Iterator[SearchEvent]:
    """
    Yield files whose embedding is close enough to the text

    Args:
        text (str): search text
        files (List[str]): candidate files
        similarity_threshold (float): minimum cosine similarity
    Returns:
        Iterator[SearchEvent]: semantic_searching then result events
    """
    from controllers.EmbeddingManager import EmbeddingManager

    yield {"type": "semantic_searching", "count": len(files)}
    query_vector = EmbeddingManager.encode_query(text)
    missing = [file for file in files if EmbeddingManager.get(file) is None]
    if missing:
        EmbeddingManager.batch_generate(missing)
    for file, _score in EmbeddingManager.search(
        query_vector,
        top_k=len(files),
        min_similarity=similarity_threshold,
        include_files=files,
    ):
        yield {"type": "result", "path": file}


class FileManager:
    schema = None
    ix = None

    @classmethod
    def setup(cls):
        logging.info("FileManager >> Setting up...")
        cls.schema = Schema(
            file=ID(stored=True),  # exact match only, fast and compact
            file_name=NGRAM(minsize=3, maxsize=7, stored=True),  # used in query
            # mime=ID(stored=True),  # filter only
            # date=DATETIME(stored=True, sortable=True),  # filter only
            # subfolder=ID(stored=True),  # filter only
            keywords=NGRAM(minsize=3, maxsize=5, stored=False),  # used in query
            summary=NGRAM(minsize=3, maxsize=5, stored=False),  # used in query
            note=NGRAM(minsize=3, maxsize=5, stored=False),  # used in query
            content=NGRAM(minsize=3, maxsize=5, stored=False),  # used in query
        )

        if not os.path.exists("/data/index"):
            os.makedirs("/data/index", exist_ok=True)
        cls.ix = create_in("/data/index", cls.schema)
        logging.info("FileManager >> Setup complete.")

    @classmethod
    def list_files(
        cls,
        start_date: str = None,
        end_date: str = None,
        subfolders: List[str] = None,
        types: List[str] = None,
        projects: List[str] = None,
        tags: List[str] = None,
        exclude_file_types: bool = False,
        exclude_subfolders: bool = False,
        exclude_projects: bool = False,
        exclude_tags: bool = False,
    ):
        files = []

        start_dt = (
            datetime.fromisoformat(start_date.replace("T", " ")) if start_date else None
        )
        end_dt = (
            datetime.fromisoformat(end_date.replace("T", " ")) if end_date else None
        )

        if projects or tags:
            db = get_db()

        try:
            for dp, _, filenames in tqdm(
                os.walk("/shared"), desc="Indexing files", unit="file"
            ):
                for filename in filenames:
                    if filename == ".DS_Store":
                        continue

                    file = os.path.join(dp, filename)
                    mime_file = guess_mime(file) or "application/octet-stream"

                    try:
                        date = datetime.fromisoformat(file.split("/")[2])
                    except Exception:
                        continue  # skip if date parsing fails

                    subfolder = file.split("/")[3]

                    # --- Handle file type filter (with exclude) ---
                    if types:
                        if exclude_file_types:
                            if mime_file in types:
                                continue
                        else:
                            if mime_file not in types:
                                continue

                    # --- Handle subfolder filter (with exclude) ---
                    if subfolders:
                        if exclude_subfolders:
                            if subfolder in subfolders:
                                continue
                        else:
                            if subfolder not in subfolders:
                                continue

                    # --- Handle date range ---
                    if start_dt and date < start_dt:
                        continue
                    if end_dt and date > end_dt:
                        continue

                    file_projects, file_tags = [], []

                    # --- Handle project filter (with exclude) ---
                    if projects:
                        file_projects = [
                            p.project
                            for p in db.query(ProjectFile)
                            .filter(ProjectFile.file == file)
                            .all()
                        ]
                        if exclude_projects:
                            if any(p in file_projects for p in projects):
                                continue
                        else:
                            if not any(p in file_projects for p in projects):
                                continue

                    # --- Handle tag filter (with exclude) ---
                    if tags:
                        file_tags = [
                            t.tag
                            for t in db.query(TagFile)
                            .filter(TagFile.file == file)
                            .all()
                        ]
                        if exclude_tags:
                            if any(t in file_tags for t in tags):
                                continue
                        else:
                            if not any(t in file_tags for t in tags):
                                continue

                    files.append(file)

        except Exception as e:
            logging.error(f"Error querying database: {str(e)}")
            raise RuntimeError(f"Error querying database: {str(e)}")

        finally:
            if projects or tags:
                db.close()

        return files

    @classmethod
    def index_files(cls, files: List[str], search_mode: int = 0) -> None:
        """
        Rebuild the full-text index from files

        Args:
            files (List[str]): files to index
            search_mode (int): 0 quick, 1 normal (+ summaries), 2 deep (+ contents)
        Returns:
            None: nothing
        """
        for _ in cls.iter_index_files(files, search_mode):
            pass

    @classmethod
    def iter_index_files(cls, files: List[str], search_mode: int = 0) -> Iterator[str]:
        """
        Rebuild the full-text index from files, yielding each file once added

        Args:
            files (List[str]): files to index
            search_mode (int): 0 quick, 1 normal (+ summaries), 2 deep (+ contents)
        Returns:
            Iterator[str]: indexed files, in order
        Raises:
            RuntimeError: index not initialized
        """
        if not cls.ix:
            raise RuntimeError("Index not initialized. Call setup() first.")
        writer = cls.ix.writer()
        writer.mergetype = writing.CLEAR  # clear existing index
        try:
            for file in files:
                writer.add_document(**index_document(file, search_mode))
                yield file
        except BaseException:
            writer.cancel()
            raise
        writer.commit()

    @classmethod
    def stream_search(
        cls,
        text: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        subfolders: Optional[List[str]] = None,
        types: Optional[List[str]] = None,
        projects: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        search_mode: int = 0,
        exclude_file_types: bool = False,
        exclude_subfolders: bool = False,
        exclude_projects: bool = False,
        exclude_tags: bool = False,
        engine: SearchEngine = SEARCH_ENGINE_CONTAINS,
        similarity_threshold: float = 0.4,
        exact: bool = False,
    ) -> Iterator[SearchEvent]:
        """
        Search files, yielding total, progress, result and error events

        Args:
            text (Optional[str]): search text
            start_date (Optional[str]): first day
            end_date (Optional[str]): last day
            subfolders (Optional[List[str]]): subfolder filter
            types (Optional[List[str]]): mime filter
            projects (Optional[List[str]]): project filter
            tags (Optional[List[str]]): tag filter
            search_mode (int): 0 quick, 1 normal, 2 deep
            exclude_file_types (bool): invert the mime filter
            exclude_subfolders (bool): invert the subfolder filter
            exclude_projects (bool): invert the project filter
            exclude_tags (bool): invert the tag filter
            engine (SearchEngine): contains (whole phrase), fuzzy (Whoosh n-grams,
                ranked) or semantic (contains + embeddings)
            similarity_threshold (float): minimum similarity of semantic matches
            exact (bool): keep special characters (contains engine only)
        Returns:
            Iterator[SearchEvent]: search events
        """
        try:
            files = cls.list_files(
                start_date=start_date,
                end_date=end_date,
                subfolders=subfolders,
                types=types,
                projects=projects,
                tags=tags,
                exclude_file_types=exclude_file_types,
                exclude_subfolders=exclude_subfolders,
                exclude_projects=exclude_projects,
                exclude_tags=exclude_tags,
            )
            files.sort(reverse=True)
            yield {"type": "total", "count": len(files)}
            query = (text or "").strip()
            if engine == SEARCH_ENGINE_FUZZY and query:
                yield from cls._stream_fuzzy(files, query, search_mode)
                return
            threshold = (
                similarity_threshold if engine == SEARCH_ENGINE_SEMANTIC else None
            )
            yield from cls._stream_contains(files, query, search_mode, exact, threshold)
        except Exception as e:
            logging.error(f"Error in stream_search: {str(e)}")
            yield {"type": "error", "message": str(e)}

    @classmethod
    def _stream_fuzzy(
        cls, files: List[str], text: str, search_mode: int
    ) -> Iterator[SearchEvent]:
        """
        Index files then yield Whoosh n-gram matches, best first

        Args:
            files (List[str]): candidate files
            text (str): non-empty search text
            search_mode (int): 0 quick, 1 normal, 2 deep
        Returns:
            Iterator[SearchEvent]: progress then result events
        """
        total = len(files)
        for position, file in enumerate(
            cls.iter_index_files(files, search_mode), start=1
        ):
            yield progress_event(position, total, file)
        with cls.ix.searcher() as searcher:
            parser = MultifieldParser(FUZZY_FIELDS, schema=cls.schema, group=OrGroup)
            hits = searcher.search(
                parser.parse(text), limit=get_setting("search_limit")
            )
            for hit in hits:
                yield {"type": "result", "path": hit["file"]}

    @classmethod
    def _stream_contains(
        cls,
        files: List[str],
        text: str,
        search_mode: int,
        exact: bool,
        similarity_threshold: Optional[float],
    ) -> Iterator[SearchEvent]:
        """
        Yield files containing the whole text, then semantic matches when a threshold is given

        Args:
            files (List[str]): candidate files
            text (str): search text (empty matches every file)
            search_mode (int): 0 quick, 1 normal, 2 deep
            exact (bool): keep special characters (no semantic phase)
            similarity_threshold (Optional[float]): semantic threshold, None skips it
        Returns:
            Iterator[SearchEvent]: progress then result events
        """
        phrase, normalize = build_query_phrase(text, exact)
        use_semantic = similarity_threshold is not None and bool(phrase) and not exact
        unmatched: List[str] = []
        total = len(files)
        for position, file in enumerate(files, start=1):
            yield progress_event(position, total, file)
            if not phrase or phrase in file_haystack(file, search_mode, normalize):
                yield {"type": "result", "path": file}
            elif use_semantic:
                unmatched.append(file)
        if unmatched and similarity_threshold is not None:
            yield from stream_semantic(text, unmatched, similarity_threshold)

    @classmethod
    def search_files(
        cls,
        text: str = None,
        start_date: str = None,
        end_date: str = None,
        subfolders: List[str] = None,
        types: List[list] = None,
        projects: List[str] = None,
        tags: List[str] = None,
        search_mode: int = 0,
        exclude_file_types: bool = False,
        exclude_subfolders: bool = False,
        exclude_projects: bool = False,
        exclude_tags: bool = False,
    ):
        files = cls.list_files(
            start_date=start_date,
            end_date=end_date,
            subfolders=subfolders,
            types=types,
            projects=projects,
            tags=tags,
            exclude_file_types=exclude_file_types,
            exclude_subfolders=exclude_subfolders,
            exclude_projects=exclude_projects,
            exclude_tags=exclude_tags,
        )
        if text:
            text = text.strip()
            if not cls.ix:
                raise RuntimeError("Index not initialised")
            cls.index_files(files, search_mode=search_mode)

            with cls.ix.searcher() as searcher:
                parser = MultifieldParser(
                    ["file_name", "keywords", "summary", "note"],
                    schema=cls.schema,
                    group=OrGroup,
                )

                if text:
                    query = parser.parse(text)
                else:
                    query = Every()

                results = searcher.search(query, limit=get_setting("search_limit"))
                return [r.get("file") for r in results]
        else:
            return files

    @classmethod
    def get_indexed_files(cls):
        if not cls.ix:
            raise Exception("Index not initialized.")

        with cls.ix.searcher() as searcher:
            return [
                searcher.stored_fields(docnum)
                for docnum in range(searcher.doc_count_all())
            ]

    @classmethod
    def get_nbr_indexed_files(cls):
        if not cls.ix:
            raise Exception("Index not initialized.")

        with cls.ix.searcher() as searcher:
            return searcher.doc_count_all()

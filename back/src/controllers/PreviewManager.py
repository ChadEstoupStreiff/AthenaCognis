import logging
import mimetypes
import tarfile
import zipfile
from pathlib import Path
from typing import Callable, List, Optional

from PIL import Image
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from controllers.JobManager import JobAlreadyQueuedError, JobManager
from db import PreviewTask
from views.settings import get_setting

try:
    import fitz  # PyMuPDF

    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False


logger = logging.getLogger(__name__)

PREVIEW_ROOT = Path("/shared/.previews")
IMAGE_PREVIEW_SUFFIX = ".jpg"
TEXT_PREVIEW_SUFFIX = ".txt"
UNSUPPORTED_RESULT = "unsupported"
JPEG_QUALITY = 75
DEFAULT_QUALITY = "medium"
DEFAULT_TARGET_SIZE = 360
DEFAULT_TEXT_CHARS = 300
DEFAULT_ZIP_SUBFILES = 15
UNREADABLE_ARCHIVE = "Could not read archive contents"

QUALITY_MAP = {
    "low": 144,
    "medium": DEFAULT_TARGET_SIZE,
    "high": 720,
}

# Vector images: PIL can't open them, the front renders the file itself.
VECTOR_IMAGE_MIMES = {"image/svg+xml"}

TEXT_EXTENSIONS = {
    "txt", "md", "markdown", "py", "js", "ts", "jsx", "tsx", "json",
    "csv", "xml", "html", "htm", "css", "yaml", "yml", "toml", "ini",
    "cfg", "conf", "sh", "bash", "rs", "go", "java", "c", "cpp", "h",
    "hpp", "cs", "rb", "php", "swift", "kt", "r", "sql", "log",
}

ARCHIVE_EXTENSIONS = {
    "zip", "tar", "gz", "bz2", "tgz", "7z", "rar",
}

ARCHIVE_MIMES = {
    "application/zip",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-bzip2",
    "application/x-7z-compressed",
}


def get_preview_path(file: str, is_image_preview: bool) -> Path:
    """
    Get where the preview of a file is stored

    Args:
        file (str): file path
        is_image_preview (bool): True for a JPEG thumbnail, False for a text excerpt
    Returns:
        Path: preview path
    """
    suffix = IMAGE_PREVIEW_SUFFIX if is_image_preview else TEXT_PREVIEW_SUFFIX
    return PREVIEW_ROOT / (file.lstrip("/") + suffix)


def prepare_preview_path(file: str, is_image_preview: bool) -> Path:
    """
    Get the preview path of a file and create its parent directory

    Args:
        file (str): file path
        is_image_preview (bool): True for a JPEG thumbnail, False for a text excerpt
    Returns:
        Path: preview path
    """
    preview_path = get_preview_path(file, is_image_preview)
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    return preview_path


def save_thumbnail(image: Image.Image, preview_path: Path) -> None:
    """
    Save an image as a compressed JPEG thumbnail

    Args:
        image (Image.Image): image
        preview_path (Path): destination
    Returns:
        None
    """
    image.save(preview_path, "JPEG", quality=JPEG_QUALITY, optimize=True)


def generate_image_preview(file: str) -> Path:
    """
    Downscale an image so its short side fits the configured quality

    Args:
        file (str): image path
    Returns:
        Path: preview path
    """
    target_size = QUALITY_MAP.get(
        str(get_setting("preview_quality", DEFAULT_QUALITY)), DEFAULT_TARGET_SIZE
    )
    image = Image.open(file).convert("RGB")
    width, height = image.size
    short_side = min(width, height)
    if short_side > target_size:
        size = (width * target_size // short_side, height * target_size // short_side)
        image = image.resize(size, Image.Resampling.LANCZOS)
    preview_path = prepare_preview_path(file, True)
    save_thumbnail(image, preview_path)
    return preview_path


def generate_pdf_preview(file: str) -> Path:
    """
    Render the first page of a PDF as a thumbnail

    Args:
        file (str): PDF path
    Returns:
        Path: preview path
    Raises:
        RuntimeError: when PyMuPDF is not installed
    """
    if not HAS_FITZ:
        raise RuntimeError("PyMuPDF not installed; cannot generate PDF previews")
    target_size = QUALITY_MAP.get(
        str(get_setting("preview_quality", DEFAULT_QUALITY)), DEFAULT_TARGET_SIZE
    )
    with fitz.open(file) as document:
        page = document[0]
        short_side = min(page.rect.width, page.rect.height)
        zoom = target_size / short_side if short_side > 0 else 1.0
        pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    preview_path = prepare_preview_path(file, True)
    save_thumbnail(image, preview_path)
    return preview_path


def generate_text_preview(file: str) -> Path:
    """
    Store the first characters of a text file

    Args:
        file (str): text file path
    Returns:
        Path: preview path
    """
    chars = int(get_setting("preview_text_chars", DEFAULT_TEXT_CHARS))
    with open(file, "r", encoding="utf-8", errors="replace") as source:
        content = source.read(chars)
    preview_path = prepare_preview_path(file, False)
    preview_path.write_text(content, encoding="utf-8")
    return preview_path


def list_archive_entries(file: str, max_entries: int) -> List[str]:
    """
    List the first entries of a zip or tar archive

    Args:
        file (str): archive path
        max_entries (int): maximum number of entries
    Returns:
        List[str]: entry names
    """
    try:
        if zipfile.is_zipfile(file):
            with zipfile.ZipFile(file, "r") as archive:
                return archive.namelist()[:max_entries]
        if tarfile.is_tarfile(file):
            with tarfile.open(file, "r:*") as tar:
                return [member.name for member in tar.getmembers()[:max_entries]]
    except (OSError, EOFError, zipfile.BadZipFile, tarfile.TarError):
        logger.warning(f"PREVIEW >> Could not read archive {file}")
        return [UNREADABLE_ARCHIVE]
    return []


def generate_archive_preview(file: str) -> Path:
    """
    Store the first entries of an archive

    Args:
        file (str): archive path
    Returns:
        Path: preview path
    """
    max_entries = int(get_setting("preview_zip_subfiles", DEFAULT_ZIP_SUBFILES))
    preview_path = prepare_preview_path(file, False)
    preview_path.write_text("\n".join(list_archive_entries(file, max_entries)), encoding="utf-8")
    return preview_path


def preview_generator(file: str) -> Optional[Callable[[str], Path]]:
    """
    Pick the preview generator of a file from its type

    Args:
        file (str): file path
    Returns:
        Optional[Callable[[str], Path]]: generator, None when unsupported
    """
    mime = mimetypes.guess_type(file)[0] or ""
    extension = Path(file).suffix.lstrip(".").lower()
    if mime in VECTOR_IMAGE_MIMES:
        return None
    if mime.startswith("image/"):
        return generate_image_preview
    if mime == "application/pdf" or extension == "pdf":
        return generate_pdf_preview
    if mime.startswith("text/") or extension in TEXT_EXTENSIONS:
        return generate_text_preview
    if mime in ARCHIVE_MIMES or extension in ARCHIVE_EXTENSIONS:
        return generate_archive_preview
    return None


class PreviewManager(JobManager):
    """Generate thumbnails and text excerpts of files."""

    name = "PREVIEW"
    task_model = PreviewTask

    @classmethod
    def process(cls, file: str, db: Session) -> str:
        """
        Generate the preview of a file

        Args:
            file (str): file path
            db (Session): session committed with the task completion
        Returns:
            str: preview path, or "unsupported"
        Raises:
            FileNotFoundError: when the file does not exist
        """
        if not Path(file).is_file():
            raise FileNotFoundError(f"File not found: {file}")
        generator = preview_generator(file)
        return UNSUPPORTED_RESULT if generator is None else str(generator(file))

    @classmethod
    def add_file_to_queue(cls, file: str) -> None:
        """
        Queue a preview, ignoring files already queued

        Args:
            file (str): file path
        Returns:
            None
        """
        try:
            super().add_file_to_queue(file)
        except JobAlreadyQueuedError:
            return
        except SQLAlchemyError:
            logger.exception(f"PREVIEW >> Error queuing {file}")

    @classmethod
    def get_preview_path(cls, file: str) -> Optional[str]:
        """
        Get the existing preview of a file

        Args:
            file (str): file path
        Returns:
            Optional[str]: preview path, None when absent
        """
        for is_image in (True, False):
            path = get_preview_path(file, is_image)
            if path.exists():
                return str(path)
        return None

    @classmethod
    def delete(cls, file: str) -> None:
        """
        Delete the tasks and preview files of a file

        Args:
            file (str): file path
        Returns:
            None
        """
        try:
            super().delete(file)
        except SQLAlchemyError:
            logger.exception(f"PREVIEW >> Error deleting tasks of {file}")
        for is_image in (True, False):
            get_preview_path(file, is_image).unlink(missing_ok=True)

    @classmethod
    def move(cls, file: str, new_file: str) -> None:
        """
        Move the tasks and preview files of a file

        Args:
            file (str): old file path
            new_file (str): new file path
        Returns:
            None
        """
        try:
            super().move(file, new_file)
        except SQLAlchemyError:
            logger.exception(f"PREVIEW >> Error moving tasks of {file}")
        for is_image in (True, False):
            old_path = get_preview_path(file, is_image)
            if old_path.exists():
                old_path.rename(prepare_preview_path(new_file, is_image))


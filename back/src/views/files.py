import json
import logging
import os
import tarfile
import traceback
import zipfile
from datetime import datetime
from io import BytesIO
from typing import List

from controllers.FileManager import FileManager
from controllers.NoteManager import NoteManager
from controllers.OCRManager import OCRManager
from controllers.PreviewManager import PreviewManager
from controllers.SummarizeManager import SummarizeManager
from controllers.TranscriptionManager import TranscriptionManager
from db import get_db
from db.models import Note, ProjectFile, TagFile, Link, StockPile, Contact, ContactFile
from fastapi import APIRouter, Body, HTTPException, UploadFile
from PIL import Image
from pillow_heif import register_heif_opener
from starlette.responses import FileResponse, Response, StreamingResponse
from utils import guess_mime, walk_files
from views.settings import get_setting
from views.stockpile import StockPile, get_recent_added
from pydub import AudioSegment

router = APIRouter(prefix="/files", tags=["Files"])

register_heif_opener()


def add_recent_added_file(file: str):
    try:
        recent_added_files = get_recent_added()
    except HTTPException:
        recent_added_files = []

    if file in recent_added_files:
        recent_added_files.remove(file)
    if len(recent_added_files) >= 10:
        recent_added_files.pop()
    recent_added_files.insert(0, file)

    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentadded").first()
        )
        if stockpile_item:
            stockpile_item.value = json.dumps(recent_added_files)
        else:
            stockpile_item = StockPile(
                key="recentadded", value=json.dumps(recent_added_files)
            )
            db.add(stockpile_item)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error adding recent added file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error adding recent added file: {str(e)}"
        )
    finally:
        db.close()


@router.post("/upload")
async def upload_files(
    files: List[UploadFile],
    subdirectory: str,
    date: str = None,
    projects: str = None,
    tags: str = None,
    contacts: str = None,
    file_edit_info: str = None,
):
    """
    Upload a file to the system.
    """
    file_edit_info = json.loads(file_edit_info) if file_edit_info else {}
    date = date or datetime.now().strftime("%Y-%m-%d")
    projects = json.loads(projects) if projects else []
    tags = json.loads(tags) if tags else []
    contacts = json.loads(contacts) if contacts else []
    try:
        for file in files:
            file_date = file_edit_info.get(file.filename, {}).get("date", date)
            file_name = (
                file_edit_info.get(file.filename, {})
                .get("name", file.filename)
                .replace("/", "_")
                .replace("\\", "_")
                .replace(":", "-")
                .replace("?", "")
            )

            os.makedirs(os.path.join("/shared", file_date, subdirectory), exist_ok=True)
            file_ext = os.path.splitext(file.filename)[1].lower()

            file_path = (
                os.path.join(
                    "/shared",
                    file_date,
                    subdirectory,
                    os.path.splitext(file_name)[0] + ".png",
                )
                if file_ext == ".heic"
                else (
                    os.path.join(
                        "/shared",
                        file_date,
                        subdirectory,
                        os.path.splitext(file_name)[0] + ".mp3",
                    )
                    if file_ext == ".m4a"
                    else os.path.join("/shared", file_date, subdirectory, file_name)
                )
            )
            file_exists = os.path.exists(file_path)

            if file_ext == ".heic":
                content = await file.read()
                image = Image.open(BytesIO(content))
                image.save(file_path, format="PNG")
            elif file_ext == ".m4a":
                content = await file.read()
                audio = AudioSegment.from_file(BytesIO(content))
                audio.export(file_path, format="mp3")
            else:
                with open(file_path, "wb") as f:
                    f.write(await file.read())

            add_recent_added_file(file_path)

            db = get_db()
            try:
                # Add to ProjectFile
                for project in projects + file_edit_info.get(file.filename, {}).get(
                    "projects", []
                ):
                    project_file = ProjectFile(file=file_path, project=project)
                    db.add(project_file)

                # Add to TagFile
                for tag in tags + file_edit_info.get(file.filename, {}).get("tags", []):
                    tag_file = TagFile(file=file_path, tag=tag)
                    db.add(tag_file)

                # Add to ContactFile
                for contact_id in contacts + file_edit_info.get(file.filename, {}).get("contacts", []):
                    contact_obj = db.query(Contact).filter(Contact.id == contact_id).first()
                    if contact_obj:
                        db.add(ContactFile(contact_id=contact_id, file=file_path))

                db.commit()
            except Exception as e:
                db.rollback()
                logging.error(f"Error adding file to database: {str(e)}")
                logging.error(traceback.format_exc())
                raise HTTPException(
                    status_code=500, detail=f"Error adding file to database: {str(e)}"
                )
            finally:
                db.close()

            if file_exists:
                os.utime(file_path, None)
            else:
                auto_summary = get_setting("enable_auto_summary")
                mime = guess_mime(file_path)

                if (
                    mime
                    and mime.startswith("image/")
                    and get_setting("enable_auto_ocr")
                ):
                    OCRManager.add_file_to_queue(file_path)
                    if auto_summary:
                        SummarizeManager.add_file_to_queue(file_path)

                elif (
                    mime and (mime.startswith("audio/") or mime.startswith("video/"))
                ) and get_setting("enable_auto_transcription"):
                    TranscriptionManager.add_file_to_queue(file_path)
                    if auto_summary:
                        SummarizeManager.add_file_to_queue(file_path)

                elif auto_summary:
                    SummarizeManager.add_file_to_queue(file_path)

                if get_setting("enable_auto_preview"):
                    PreviewManager.add_file_to_queue(file_path)

        return {"message": f"{len(files)} files uploaded successfully."}
    except Exception as e:
        for file in files:
            file_path = os.path.join("/shared", date, subdirectory, file.filename)
            if os.path.exists(file_path):
                os.remove(file_path)
            SummarizeManager.delete(file_path)
            OCRManager.delete(file_path)
            TranscriptionManager.delete(file_path)
            PreviewManager.delete(file_path)
        logging.error(f"Removed files after error: {file_path}")

        logging.error(f"Error uploading files: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error uploading files: {str(e)}")


@router.delete("/delete/{file:path}")
async def delete_file(file: str):
    """
    Delete a file from the system.
    """
    try:
        file_path = os.path.join(file)
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file} does not exist.")

        SummarizeManager.delete(file_path)
        OCRManager.delete(file_path)
        TranscriptionManager.delete(file_path)
        PreviewManager.delete(file_path)
        NoteManager.delete(file_path)

        db = get_db()
        try:
            # Delete ProjectFile entries
            file_name = file_path.split("/")[-1]
            file_date = file_path.split("/")[2]
            db.query(ProjectFile).filter(ProjectFile.file == file_path).delete()
            db.query(TagFile).filter(TagFile.file == file_path).delete()
            db.query(Note).filter(Note.file == file_path).delete()
            db.query(Link).filter(Link.fileA == file_path).delete()
            db.query(Link).filter(Link.fileB == file_path).delete()
            db.query(StockPile).filter(StockPile.key == f"sota_info_{file_date}_{file_name}").delete()

            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error deleting database entries for file {file}: {str(e)}")
            logging.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error deleting database entries: {str(e)}"
            )
        finally:
            db.close()

        os.remove(file_path)
        return {"message": f"File {file} deleted successfully."}
    except FileNotFoundError as e:
        logging.error(f"File not found: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/move/{file:path}")
async def move_file(
    file: str, subfolder: str = None, date: str = None, name: str = None
):
    """
    Move a file to a new location.
    """
    file = file.strip()

    try:
        if not os.path.exists(file):
            raise FileNotFoundError(f"File {file} does not exist.")

        if name is None:
            name = os.path.basename(file)
        if date is None:
            date = file.split("/")[2]
        if subfolder is None:
            subfolder = file.split("/")[3]

        new_directory = os.path.join("/shared", date, subfolder)
        if not os.path.exists(new_directory):
            os.makedirs(new_directory, exist_ok=True)

        new_file_path = os.path.join(new_directory, name)
        if os.path.exists(new_file_path):
            raise HTTPException(
                status_code=400,
                detail=f"File {name} already exists in {new_directory}.",
            )

        SummarizeManager.move(file, new_file_path)
        OCRManager.move(file, new_file_path)
        TranscriptionManager.move(file, new_file_path)
        PreviewManager.move(file, new_file_path)
        NoteManager.move(file, new_file_path)
        db = get_db()
        try:
            # Update ProjectFile entries
            project_files = db.query(ProjectFile).filter(ProjectFile.file == file).all()
            for project_file in project_files:
                project_file.file = new_file_path
            db.commit()

            # Update TagFile entries
            tag_files = db.query(TagFile).filter(TagFile.file == file).all()
            for tag_file in tag_files:
                tag_file.file = new_file_path

            # Update links entries
            links_a = db.query(Link).filter(Link.fileA == file).all()
            for link in links_a:
                link.fileA = new_file_path
            links_b = db.query(Link).filter(Link.fileB == file).all()
            for link in links_b:
                link.fileB = new_file_path
            
            # Update StockPile entries
            file_name = file.split("/")[-1]
            file_date = file.split("/")[2]
            stockpile_item = (
                db.query(StockPile).filter(StockPile.key == f"sota_info_{file_date}_{file_name}").first()
            )
            if stockpile_item:
                new_file_name = name
                new_file_date = date
                stockpile_item.key = f"sota_info_{new_file_date}_{new_file_name}"

            db.commit()
        except Exception as e:
            db.rollback()
            logging.error(f"Error updating database entries: {str(e)}")
            logging.error(traceback.format_exc())
            raise HTTPException(
                status_code=500, detail=f"Error updating database entries: {str(e)}"
            )
        finally:
            db.close()
        os.rename(file, new_file_path)

        return new_file_path
    except FileNotFoundError as e:
        logging.error(f"File not found: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/download/{file:path}")
async def get_file(file: str):
    """
    Get a file by its path. Returns correct media type for browser rendering.
    """
    if os.path.exists(file):
        return FileResponse(
            file,
            media_type=guess_mime(file),
            filename=os.path.basename(file),
        )
    else:
        raise HTTPException(status_code=404, detail=f"File {file} not found.")


@router.post("/download-zip")
def download_zip(files: List[str] = Body(...)):
    """Build an in-memory ZIP of the requested files.

    Each entry is named <date>_<original_filename> where <date> comes from the
    second path component of /shared/<date>/...
    """
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        seen = {}
        for file_path in files:
            if not os.path.exists(file_path):
                continue
            parts = file_path.split("/")
            date = parts[2] if len(parts) > 2 else "unknown"
            filename = os.path.basename(file_path)
            arcname = f"{date}_{filename}"
            # Deduplicate: if the same name would appear twice, suffix with a counter
            if arcname in seen:
                seen[arcname] += 1
                stem, ext = os.path.splitext(arcname)
                arcname = f"{stem}_{seen[arcname]}{ext}"
            else:
                seen[arcname] = 0
            zf.write(file_path, arcname)
    buffer.seek(0)
    return Response(
        content=buffer.read(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="selection.zip"'},
    )


@router.get("/metadata/{file:path}")
async def get_file_metadata(file: str):
    """
    Get metadata of a file.
    """
    try:
        file_path = os.path.join(file)
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File {file} does not exist.")
        
        mime = guess_mime(file_path)
        metadata = {
            "size": os.path.getsize(file_path),
            "created": datetime.fromtimestamp(os.path.getctime(file_path)).isoformat(),
            "modified": datetime.fromtimestamp(os.path.getmtime(file_path)).isoformat(),
            "path": file_path,
            "mime_type": guess_mime(file_path),
        }

        ARCHIVE_LIMIT = 100
        if mime.endswith("zip"):
            try:
                with zipfile.ZipFile(file_path, "r") as z:
                    all_names = z.namelist()
                    metadata["zip_paths"] = all_names[:ARCHIVE_LIMIT]
                    metadata["zip_paths_truncated"] = len(all_names) > ARCHIVE_LIMIT
                    metadata["zip_paths_total"] = len(all_names)
            except Exception as e:
                logging.error(f"Error reading archive contents: {str(e)}")
        elif mime.endswith(("tar.gz", "tgz", "tar")):
            try:
                with tarfile.open(file_path, "r") as tar:
                    all_names = tar.getnames()
                    metadata["zip_paths"] = all_names[:ARCHIVE_LIMIT]
                    metadata["zip_paths_truncated"] = len(all_names) > ARCHIVE_LIMIT
                    metadata["zip_paths_total"] = len(all_names)
            except Exception as e:
                logging.error(f"Error reading archive contents: {str(e)}")

        return metadata
    except FileNotFoundError as e:
        logging.error(f"File not found: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/list")
async def list_files():
    """
    List all files in the system.
    """
    result = walk_files()
    result.sort()
    result.reverse()
    return result


@router.get("/count")
async def count_files():
    """
    Count the number of files in the system.
    """
    return len(walk_files())


@router.get("/search")
async def search_files(
    text: str = None,
    start_date: str = None,
    end_date: str = None,
    subfolder: str = None,
    types: str = None,
    projects: str = None,
    tags: str = None,
    search_mode: int = 0,  # 0: FAST, 1: NORMAL, 2: DEEP
    exclude_file_types: bool = False,
    exclude_subfolders: bool = False,
    exclude_projects: bool = False,
    exclude_tags: bool = False,
):
    """
    Search for files based on a query.
    """
    if text is not None and len(text) == 0:
        text = None
    if types is not None and len(types) == 0:
        types = None
    if subfolder is not None and len(subfolder) == 0:
        subfolder = None
    if projects is not None and len(projects) == 0:
        projects = None
    if tags is not None and len(tags) == 0:
        tags = None

    try:
        result = FileManager.search_files(
            text,
            start_date,
            end_date,
            subfolder.split(",") if subfolder else None,
            types.split(",") if types else None,
            projects.split(",") if projects else None,
            tags.split(",") if tags else None,
            search_mode=search_mode,
            exclude_file_types=exclude_file_types,
            exclude_subfolders=exclude_subfolders,
            exclude_projects=exclude_projects,
            exclude_tags=exclude_tags,
        )
        result.sort()
        result.reverse()
        return result
    except Exception as e:
        logging.error(f"Error searching files: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error searching files: {str(e)}")


@router.get("/search/stream")
def search_files_stream(
    text: str = None,
    start_date: str = None,
    end_date: str = None,
    subfolder: str = None,
    types: str = None,
    projects: str = None,
    tags: str = None,
    search_mode: int = 0,
    exclude_file_types: bool = False,
    exclude_subfolders: bool = False,
    exclude_projects: bool = False,
    exclude_tags: bool = False,
    semantic: bool = False,
    similarity_threshold: float = 0.4,
):
    """Search for files and stream progress + results as NDJSON."""
    if text is not None and len(text) == 0:
        text = None
    if types is not None and len(types) == 0:
        types = None
    if subfolder is not None and len(subfolder) == 0:
        subfolder = None
    if projects is not None and len(projects) == 0:
        projects = None
    if tags is not None and len(tags) == 0:
        tags = None

    def generate():
        for event in FileManager.stream_search(
            text,
            start_date,
            end_date,
            subfolder.split(",") if subfolder else None,
            types.split(",") if types else None,
            projects.split(",") if projects else None,
            tags.split(",") if tags else None,
            search_mode=search_mode,
            exclude_file_types=exclude_file_types,
            exclude_subfolders=exclude_subfolders,
            exclude_projects=exclude_projects,
            exclude_tags=exclude_tags,
            semantic=semantic,
            similarity_threshold=similarity_threshold,
        ):
            yield json.dumps(event) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/index")
async def index_files():
    """
    Index all files in the system.
    """
    try:
        return FileManager.get_indexed_files()
    except Exception as e:
        logging.error(f"Error getting indexed files: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error getting indexed files: {str(e)}"
        )


@router.post("/index")
async def reindex_files():
    """
    Reindex all files in the system.
    """
    try:
        FileManager.index_files()
        return {"message": "Files reindexed successfully."}
    except Exception as e:
        logging.error(f"Error reindexing files: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error reindexing files: {str(e)}")

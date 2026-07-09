import logging
import traceback

from db import Tag, TagFile, get_db
from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["Tags"])


@router.get("/tags")
async def list_tags():
    """
    List all tags.
    """
    db = get_db()
    try:
        tags = db.query(Tag).all()
        return [tag.__dict__ for tag in tags]
    except Exception as e:
        logging.error(f"Error retrieving tags: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error retrieving tags: {str(e)}")
    finally:
        db.close()


@router.get("/tag/{tag_name}")
async def get_tag(tag_name: str):
    """
    Get a specific tag by name.
    """
    db = get_db()
    try:
        tag = db.query(Tag).filter(Tag.name == tag_name).first()
        if not tag:
            raise HTTPException(status_code=404, detail=f"Tag {tag_name} not found.")
        return tag.__dict__
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving tag {tag_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving tag {tag_name}: {str(e)}"
        )
    finally:
        db.close()


@router.post("/tag")
async def create_tag(name: str, color: str):
    """
    Create a new tag.
    """
    if not color.startswith("#"):
        color = f"#{color}"
    db = get_db()
    try:
        tag = Tag(name=name, color=color)
        db.add(tag)
        db.commit()
        return {"message": "Tag created successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating tag: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error creating tag: {str(e)}")
    finally:
        db.close()


@router.put("/tag/{tag_name}")
async def update_tag(tag_name: str, name: str = None, color: str = None):
    """
    Update an existing tag.
    """
    if color is not None and not color.startswith("#"):
        color = f"#{color}"
    db = get_db()
    try:
        existing_tag = db.query(Tag).filter(Tag.name == tag_name).first()
        if not existing_tag:
            raise HTTPException(status_code=404, detail=f"Tag {tag_name} not found.")

        if name:
            existing_tag.name = name
        if color:
            existing_tag.color = color

        db.commit()
        return {"message": "Tag updated successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating tag {tag_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error updating tag {tag_name}: {str(e)}"
        )
    finally:
        db.close()


@router.get("/tags_of/{file:path}")
async def get_tags_of_file(file: str):
    """
    Get all tags associated with a specific file.
    """
    db = get_db()
    try:
        tags = db.query(Tag).join(TagFile).filter(TagFile.file == file).all()
        return [t.__dict__ for t in tags]
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving tags for file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving tags for file {file}: {str(e)}"
        )
    finally:
        db.close()


@router.post("/tag/{tag_name}/file")
async def add_file_to_tag(tag_name: str, file: str):
    """
    Add a file to a tag.
    """
    tag_name = tag_name.strip().replace(",", "_")
    db = get_db()
    try:
        tag = db.query(Tag).filter(Tag.name == tag_name).first()
        if not tag:
            raise HTTPException(status_code=404, detail=f"Tag {tag_name} not found.")

        tag_file = TagFile(file=file, tag=tag_name)
        db.add(tag_file)
        db.commit()
        return {"message": "File added to tag successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error adding file to tag {tag_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error adding file to tag {tag_name}: {str(e)}"
        )
    finally:
        db.close()


@router.get("/tag/{tag_name}/files")
async def get_files_by_tag(tag_name: str):
    """
    Get all files associated with a specific tag.
    """
    db = get_db()
    try:
        tag_files = db.query(TagFile).filter(TagFile.tag == tag_name).all()
        if not tag_files:
            raise HTTPException(
                status_code=404, detail=f"No files found for tag {tag_name}."
            )
        return [tf.file for tf in tag_files]
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving files for tag {tag_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving files for tag {tag_name}: {str(e)}",
        )
    finally:
        db.close()


@router.delete("/tag/{tag_name}/file")
async def remove_file_from_tag(tag_name: str, file: str):
    """
    Remove a file from a tag.
    """
    db = get_db()
    try:
        tag_file = (
            db.query(TagFile)
            .filter(TagFile.tag == tag_name, TagFile.file == file)
            .delete()
        )
        if not tag_file:
            raise HTTPException(
                status_code=404, detail=f"File {file} not found in tag {tag_name}."
            )

        db.commit()
        return {"message": "File removed from tag successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error removing file from tag {tag_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error removing file from tag {tag_name}: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/tag/{tag_name}")
async def delete_tag(tag_name: str):
    """
    Delete a tag and all associated files.
    """
    db = get_db()
    try:
        tag = db.query(Tag).filter(Tag.name == tag_name).first()
        if not tag:
            raise HTTPException(status_code=404, detail=f"Tag {tag_name} not found.")

        # Delete all files associated with the tag
        tag_files = db.query(TagFile).filter(TagFile.tag == tag_name).all()
        for tf in tag_files:
            db.delete(tf)

        # Delete the tag itself
        db.delete(tag)
        db.commit()
        return {"message": "Tag and all associated files deleted successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting tag {tag_name} and its files: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error deleting tag {tag_name} and its files: {str(e)}",
        )
    finally:
        db.close()

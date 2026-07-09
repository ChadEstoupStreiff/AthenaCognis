import json
import logging
import traceback

from db import Contact, ContactProject, Project, ProjectFile, get_db
from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["Projects"])


@router.get("/projects")
async def list_projects():
    """
    List all projects.
    """
    db = get_db()
    try:
        projects = db.query(Project).all()
        return [project.__dict__ for project in projects]
    except Exception as e:
        logging.error(f"Error retrieving projects: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving projects: {str(e)}"
        )
    finally:
        db.close()


@router.get("/project/{project_name}/files")
async def get_project_files(project_name: str):
    """
    Get all files associated with a specific project.
    """
    db = get_db()
    try:
        project_files = (
            db.query(ProjectFile).filter(ProjectFile.project == project_name).all()
        )
        return [pf.file for pf in project_files]
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving files for project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving files for project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.get("/project/{project_name}/contacts")
async def get_project_contacts(project_name: str):
    """
    Get all contacts linked to a specific project.
    """
    db = get_db()
    try:
        contacts = (
            db.query(Contact)
            .join(ContactProject, ContactProject.contact_id == Contact.id)
            .filter(ContactProject.project_name == project_name)
            .order_by(Contact.name)
            .all()
        )
        return [
            {
                "id": c.id,
                "name": c.name,
                "email": c.email,
                "phone": c.phone,
                "company": c.company,
                "role": c.role,
                "description": c.description,
            }
            for c in contacts
        ]
    except Exception as e:
        logging.error(f"Error retrieving contacts for project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving contacts for project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.get("/projects_of/{file:path}")
async def get_project_of_file(file: str):
    """
    Get the project associated with a specific file.
    """
    db = get_db()
    try:
        projects = (
            db.query(Project).join(ProjectFile).filter(ProjectFile.file == file).all()
        )
        return [p.__dict__ for p in projects]
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving project for file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving project for file {file}: {str(e)}",
        )
    finally:
        db.close()


@router.post("/project/{project_name}/file")
async def add_file_to_project(project_name: str, file: str):
    """
    Add a file to a project.
    """
    project_name = project_name.strip().replace(",", "_")
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        project_file = ProjectFile(file=file, project=project_name)
        db.add(project_file)
        db.commit()
        return {"message": "File added to project successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error adding file to project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error adding file to project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.delete("/project/{project_name}/file")
async def remove_file_from_project(project_name: str, file: str):
    """
    Remove a file from a project.
    """
    db = get_db()
    try:
        project_file = (
            db.query(ProjectFile)
            .filter(ProjectFile.project == project_name, ProjectFile.file == file)
            .delete()
        )
        if not project_file:
            raise HTTPException(
                status_code=404,
                detail=f"File {file} not found in project {project_name}.",
            )

        db.commit()
        return {"message": "File removed from project successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error removing file from project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error removing file from project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.get("/project/{project_name}")
async def get_project(project_name: str):
    """
    Get a specific project by name.
    """
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )
        return project.__dict__
    except HTTPException as e:
        raise e
    except Exception as e:
        logging.error(f"Error retrieving project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving project {project_name}: {str(e)}"
        )
    finally:
        db.close()


@router.post("/project")
async def create_project(name: str, color: str, description: str = None):
    """
    Create a new project.
    """
    if not color.startswith("#"):
        color = f"#{color}"
    db = get_db()
    try:
        project = Project(
            name=name,
            description=description,
            color=color,
        )
        db.add(project)
        db.commit()
        return {"message": "Project created successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating project: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error creating project: {str(e)}")
    finally:
        db.close()


@router.put("/project/{project_name}")
async def update_project(
    project_name: str, name: str = None, color: str = None, description: str = None
):
    """
    Update an existing project.
    """
    if color is not None and not color.startswith("#"):
        color = f"#{color}"
    db = get_db()
    try:
        existing_project = (
            db.query(Project).filter(Project.name == project_name).first()
        )
        if not existing_project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        if name:
            existing_project.name = name
        if color:
            existing_project.color = color
        if description is not None:  # Allow description to be None
            existing_project.description = description

        db.commit()
        return {"message": "Project updated successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error updating project {project_name}: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/project/{project_name}")
async def delete_project(project_name: str):
    """
    Delete a project by name.
    """
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        # Delete all files associated with the project
        project_files = (
            db.query(ProjectFile).filter(ProjectFile.project == project_name).all()
        )
        for pf in project_files:
            db.delete(pf)

        # Delete the project itself
        db.delete(project)
        db.commit()
        return {"message": "Project deleted successfully."}
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error deleting project {project_name}: {str(e)}"
        )
    finally:
        db.close()


@router.get("/project/{project_name}/notes")
async def get_project_notes(project_name: str):
    """
    Get all notes associated with a specific project.
    """
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        return project.notes
    except Exception as e:
        logging.error(f"Error retrieving notes for project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving notes for project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.post("/project/{project_name}/notes")
async def set_project_notes(project_name: str, notes: str):
    """
    Set notes for a specific project.
    """
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        project.notes = notes
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error setting notes for project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error setting notes for project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.get("/project/{project_name}/todo")
async def get_project_todo(project_name: str):
    """
    Get all TODO items associated with a specific project.
    """
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        return json.loads(project.todo)
    except Exception as e:
        logging.error(f"Error retrieving TODO for project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving TODO for project {project_name}: {str(e)}",
        )
    finally:
        db.close()


@router.post("/project/{project_name}/todo")
async def set_project_todo(project_name: str, todo: str):
    """
    Set TODO items for a specific project.
    """
    db = get_db()
    try:
        project = db.query(Project).filter(Project.name == project_name).first()
        if not project:
            raise HTTPException(
                status_code=404, detail=f"Project {project_name} not found."
            )

        project.todo = todo
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error setting TODO for project {project_name}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error setting TODO for project {project_name}: {str(e)}",
        )
    finally:
        db.close()

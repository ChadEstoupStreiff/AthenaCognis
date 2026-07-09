import logging
import traceback
from datetime import datetime
from typing import List, Optional

from db import (
    KanbanBoard,
    KanbanColumn,
    KanbanColumnTask,
    Task,
    TaskCalendar,
    TaskContact,
    TaskFile,
    TaskProject,
    TaskStateEnum,
    TaskTag,
    get_db,
)
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["Tasks"])


@router.get("/tasks")
async def list_tasks(
    projects: List[str] = None, tags: List[str] = None, state: TaskStateEnum = None
):
    """
    List all tasks.
    """
    db = get_db()
    try:
        tasks = db.query(Task)
        if projects is not None:
            tasks = tasks.join(TaskProject).filter(TaskProject.project.in_(projects))
        if tags is not None:
            tasks = tasks.join(TaskTag).filter(TaskTag.tag.in_(tags))
        if state is not None:
            tasks = tasks.filter(Task.state == state)
        tasks = tasks.all()
        return [task.__dict__ for task in tasks]
    except Exception as e:
        logging.error(f"Error retrieving tasks: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error retrieving tasks: {str(e)}")
    finally:
        db.close()


class TaskCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    projects: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    files: Optional[List[str]] = None
    calendars: Optional[List[str]] = None
    contacts: Optional[List[str]] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    priority: Optional[float] = 0.0


@router.post("/tasks")
async def create_task(task: TaskCreateRequest):
    """
    Create a new task.
    """
    db = get_db()
    try:
        task_db = Task(
            title=task.title,
            description=task.description,
            start_date=task.start_date,
            end_date=task.end_date,
            priority=task.priority,
        )
        db.add(task_db)
        db.flush()
        for project in task.projects or []:
            db.add(TaskProject(task_id=task_db.id, project_name=project))
        for tag in task.tags or []:
            db.add(TaskTag(task_id=task_db.id, tag=tag))
        for file in task.files or []:
            db.add(TaskFile(task_id=task_db.id, file=file))
        for calendar in task.calendars or []:
            db.add(TaskCalendar(task_id=task_db.id, calendar_id=calendar))
        for contact in task.contacts or []:
            db.add(TaskContact(task_id=task_db.id, contact_id=contact))
        db.commit()
        db.refresh(task_db)
        return task_db.__dict__
    except Exception as e:
        logging.error(f"Error creating task: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error creating task: {str(e)}")
    finally:
        db.close()


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """
    Get a task by ID.
    """
    db = get_db()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        projects = db.query(TaskProject).filter(TaskProject.task_id == task_id).all()
        tags = db.query(TaskTag).filter(TaskTag.task_id == task_id).all()
        files = db.query(TaskFile).filter(TaskFile.task_id == task_id).all()
        calendars = db.query(TaskCalendar).filter(TaskCalendar.task_id == task_id).all()
        contacts = db.query(TaskContact).filter(TaskContact.task_id == task_id).all()
        if task:
            task.__dict__["projects"] = [p.project_name for p in projects]
            task.__dict__["tags"] = [t.tag for t in tags]
            task.__dict__["files"] = [f.file for f in files]
            task.__dict__["calendars"] = [c.calendar_id for c in calendars]
            task.__dict__["contacts"] = [c.contact_id for c in contacts]
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        return task.__dict__
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error retrieving task: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error retrieving task: {str(e)}")
    finally:
        db.close()


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """
    Delete a task by ID.
    """
    db = get_db()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        for project in (
            db.query(TaskProject).filter(TaskProject.task_id == task_id).all()
        ):
            db.delete(project)
        for tag in db.query(TaskTag).filter(TaskTag.task_id == task_id).all():
            db.delete(tag)
        for file in db.query(TaskFile).filter(TaskFile.task_id == task_id).all():
            db.delete(file)
        for calendar in (
            db.query(TaskCalendar).filter(TaskCalendar.task_id == task_id).all()
        ):
            db.delete(calendar)
        for contact in (
            db.query(TaskContact).filter(TaskContact.task_id == task_id).all()
        ):
            db.delete(contact)
        db.delete(task)
        db.commit()
        return {"detail": "Task deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error deleting task: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error deleting task: {str(e)}")
    finally:
        db.close()


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, task: TaskCreateRequest):
    """
    Update a task by ID.
    """
    db = get_db()
    try:
        existing_task = db.query(Task).filter(Task.id == task_id).first()
        if not existing_task:
            raise HTTPException(status_code=404, detail="Task not found")
        existing_task.title = task.title
        existing_task.description = task.description
        existing_task.start_date = task.start_date
        existing_task.end_date = task.end_date
        existing_task.priority = task.priority
        for project in (
            db.query(TaskProject).filter(TaskProject.task_id == task_id).all()
        ):
            db.delete(project)
        for tag in db.query(TaskTag).filter(TaskTag.task_id == task_id).all():
            db.delete(tag)
        for file in db.query(TaskFile).filter(TaskFile.task_id == task_id).all():
            db.delete(file)
        for calendar in (
            db.query(TaskCalendar).filter(TaskCalendar.task_id == task_id).all()
        ):
            db.delete(calendar)
        for contact in (
            db.query(TaskContact).filter(TaskContact.task_id == task_id).all()
        ):
            db.delete(contact)
        for project in task.projects or []:
            db.add(TaskProject(task_id=task_id, project_name=project))
        for tag in task.tags or []:
            db.add(TaskTag(task_id=task_id, tag=tag))
        for file in task.files or []:
            db.add(TaskFile(task_id=task_id, file=file))
        for calendar in task.calendars or []:
            db.add(TaskCalendar(task_id=task_id, calendar_id=calendar))
        for contact in task.contacts or []:
            db.add(TaskContact(task_id=task_id, contact_id=contact))
        db.commit()
        db.refresh(existing_task)
        return existing_task.__dict__
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error updating task: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error updating task: {str(e)}")
    finally:
        db.close()


@router.put("/tasks/{task_id}/complete")
async def complete_task(task_id: str):
    """
    Mark a task as completed.
    """
    db = get_db()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        if task.completed is not None:
            task.completed = None
        else:
            task.completed = datetime.utcnow()
        db.commit()
        db.refresh(task)
        return task.__dict__
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error completing task: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error completing task: {str(e)}")
    finally:
        db.close()

# MARK: KANBAN BOARD ENDPOINTS
@router.get("/kanban/boards")
async def list_kanban_boards():
    """
    List all Kanban boards.
    """
    db = get_db()
    try:
        boards = db.query(KanbanBoard).all()
        return [board.__dict__ for board in boards]
    except Exception as e:
        logging.error(f"Error retrieving Kanban boards: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving Kanban boards: {str(e)}"
        )
    finally:
        db.close()


@router.post("/kanban/boards")
async def create_kanban_board(name: str, description: Optional[str] = None):
    """
    Create a new Kanban board.
    """
    db = get_db()
    try:
        board = KanbanBoard(name=name, description=description)
        db.add(board)
        db.commit()
        db.refresh(board)
        return board.__dict__
    except Exception as e:
        logging.error(f"Error creating Kanban board: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error creating Kanban board: {str(e)}"
        )
    finally:
        db.close()


@router.get("/kanban/boards/{board_id}")
async def get_kanban_board(board_id: str):
    """
    Get a Kanban board by ID.
    """
    db = get_db()
    try:
        board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
        columns = db.query(KanbanColumn).filter(KanbanColumn.board_id == board_id).all()
        if board:
            board.__dict__["columns"] = sorted(
                [column.__dict__ for column in columns], key=lambda x: x["position"]
            )
            for column in board.__dict__["columns"]:
                tasks = (
                    db.query(Task)
                    .join(KanbanColumnTask)
                    .filter(KanbanColumnTask.column_id == column["id"])
                    .all()
                )
                column["tasks"] = sorted(
                    [task.__dict__ for task in tasks],
                    key=lambda x: (
                        x["completed"] is not None,
                        -x["priority"],
                        x["end_date"] is None,
                        x["end_date"],
                        x["start_date"] is None,
                        x["start_date"],
                    ),
                )
                for task in column["tasks"]:
                    projects = (
                        db.query(TaskProject)
                        .filter(TaskProject.task_id == task["id"])
                        .all()
                    )
                    tags = db.query(TaskTag).filter(TaskTag.task_id == task["id"]).all()
                    files = (
                        db.query(TaskFile).filter(TaskFile.task_id == task["id"]).all()
                    )
                    calendars = (
                        db.query(TaskCalendar)
                        .filter(TaskCalendar.task_id == task["id"])
                        .all()
                    )
                    contacts = (
                        db.query(TaskContact)
                        .filter(TaskContact.task_id == task["id"])
                        .all()
                    )
                    task["projects"] = [p.project_name for p in projects]
                    task["tags"] = [t.tag for t in tags]
                    task["files"] = [f.file for f in files]
                    task["calendars"] = [c.calendar_id for c in calendars]
                    task["contacts"] = [c.contact_id for c in contacts]
        if not board:
            raise HTTPException(status_code=404, detail="Kanban board not found")
        return board.__dict__
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error retrieving Kanban board: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving Kanban board: {str(e)}"
        )
    finally:
        db.close()


@router.put("/kanban/boards/{board_id}")
async def update_kanban_board(
    board_id: str, name: str, description: Optional[str] = None
):
    """Update a Kanban board by ID."""
    db = get_db()
    try:
        board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
        if not board:
            raise HTTPException(status_code=404, detail="Kanban board not found")
        board.name = name
        board.description = description
        db.commit()
        db.refresh(board)
        return board.__dict__
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error updating Kanban board: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error updating Kanban board: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/kanban/boards/{board_id}")
async def delete_kanban_board(board_id: str):
    """
    Delete a Kanban board by ID.
    """
    db = get_db()
    try:
        board = db.query(KanbanBoard).filter(KanbanBoard.id == board_id).first()
        if not board:
            raise HTTPException(status_code=404, detail="Kanban board not found")
        db.delete(board)
        db.commit()
        return {"detail": "Kanban board deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error deleting Kanban board: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error deleting Kanban board: {str(e)}"
        )
    finally:
        db.close()


class KanbanColumnRequest(BaseModel):
    name: str
    color: Optional[str] = None
    position: float


@router.get("/kanban/boards/{board_id}/columns")
async def list_kanban_columns(board_id: str):
    """
    List all columns for a Kanban board.
    """
    db = get_db()
    try:
        columns = db.query(KanbanColumn).filter(KanbanColumn.board_id == board_id).all()
        return [column.__dict__ for column in columns]
    except Exception as e:
        logging.error(f"Error retrieving Kanban columns: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving Kanban columns: {str(e)}"
        )
    finally:
        db.close()


@router.post("/kanban/boards/{board_id}/columns")
async def create_kanban_column(board_id: str, column: KanbanColumnRequest):
    """
    Create a new column for a Kanban board.
    """
    db = get_db()
    try:
        column = KanbanColumn(
            board_id=board_id,
            name=column.name,
            color=column.color,
            position=column.position,
        )
        db.add(column)
        db.commit()
        db.refresh(column)
        return column.__dict__
    except Exception as e:
        logging.error(f"Error creating Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error creating Kanban column: {str(e)}"
        )
    finally:
        db.close()


@router.put("/kanban/columns/{column_id}")
async def update_kanban_column(column_id: str, column: KanbanColumnRequest):
    """
    Update a Kanban column by ID.
    """
    db = get_db()
    try:
        existing_column = (
            db.query(KanbanColumn).filter(KanbanColumn.id == column_id).first()
        )
        if not existing_column:
            raise HTTPException(status_code=404, detail="Kanban column not found")
        existing_column.name = column.name
        existing_column.color = column.color
        existing_column.position = column.position
        db.commit()
        db.refresh(existing_column)
        return existing_column.__dict__
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error updating Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error updating Kanban column: {str(e)}"
        )
    finally:
        db.close()

@router.put("/kanban/columns/{column_id}/move/left")
async def move_kanban_column_left(column_id: str):
    """
    Move a Kanban column one position to the left.
    """
    db = get_db()
    try:
        column = db.query(KanbanColumn).filter(KanbanColumn.id == column_id).first()
        if not column:
            raise HTTPException(status_code=404, detail="Kanban column not found")
        columns = (
            db.query(KanbanColumn)
            .filter(KanbanColumn.board_id == column.board_id)
            .order_by(KanbanColumn.position)
            .all()
        )
        current_index = columns.index(column)
        if current_index == 0:
            raise HTTPException(status_code=400, detail="Kanban column is already at the leftmost position")
        previous_column = columns[current_index - 1]
        # Swap positions
        old_position = column.position
        new_position = previous_column.position
        column.position = new_position
        previous_column.position = old_position
        db.commit()
        return {"detail": "Kanban column moved left"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error moving Kanban column left: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error moving Kanban column left: {str(e)}"
        )
    finally:
        db.close()

@router.put("/kanban/columns/{column_id}/move/right")
async def move_kanban_column_right(column_id: str):
    """
    Move a Kanban column one position to the right.
    """
    db = get_db()
    try:
        column = db.query(KanbanColumn).filter(KanbanColumn.id == column_id).first()
        if not column:
            raise HTTPException(status_code=404, detail="Kanban column not found")
        columns = (
            db.query(KanbanColumn)
            .filter(KanbanColumn.board_id == column.board_id)
            .order_by(KanbanColumn.position)
            .all()
        )
        current_index = columns.index(column)
        if current_index == len(columns) - 1:
            raise HTTPException(status_code=400, detail="Kanban column is already at the rightmost position")
        next_column = columns[current_index + 1]
        # Swap positions
        old_position = column.position
        new_position = next_column.position
        column.position = new_position
        next_column.position = old_position
        db.commit()
        return {"detail": "Kanban column moved right"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error moving Kanban column right: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error moving Kanban column right: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/kanban/columns/{column_id}")
async def delete_kanban_column(column_id: str):
    """
    Delete a Kanban column by ID.
    """
    db = get_db()
    try:
        column = db.query(KanbanColumn).filter(KanbanColumn.id == column_id).first()
        if not column:
            raise HTTPException(status_code=404, detail="Kanban column not found")
        db.delete(column)
        db.commit()
        return {"detail": "Kanban column deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error deleting Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error deleting Kanban column: {str(e)}"
        )
    finally:
        db.close()


@router.get("/kanban/columns/{column_id}/tasks")
async def list_tasks_in_kanban_column(column_id: str):
    """
    List all tasks in a Kanban column.
    """
    db = get_db()
    try:
        tasks = (
            db.query(Task)
            .join(KanbanColumnTask)
            .filter(KanbanColumnTask.column_id == column_id)
            .all()
        )
        return [task.__dict__ for task in tasks]
    except Exception as e:
        logging.error(f"Error retrieving tasks in Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving tasks in Kanban column: {str(e)}"
        )
    finally:
        db.close()


@router.post("/kanban/columns/{column_id}/tasks/{task_id}")
async def add_task_to_kanban_column(column_id: str, task_id: str):
    """
    Add a task to a Kanban column.
    """
    db = get_db()
    try:
        column = db.query(KanbanColumn).filter(KanbanColumn.id == column_id).first()
        if not column:
            raise HTTPException(status_code=404, detail="Kanban column not found")
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        existing_entry = (
            db.query(KanbanColumnTask)
            .filter(
                KanbanColumnTask.column_id == column_id,
                KanbanColumnTask.task_id == task_id,
            )
            .first()
        )
        if existing_entry:
            raise HTTPException(status_code=400, detail="Task already in Kanban column")
        db.add(KanbanColumnTask(column_id=column_id, task_id=task_id))
        db.commit()
        return {"detail": "Task added to Kanban column"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error adding task to Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error adding task to Kanban column: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/kanban/columns/{column_id}/tasks/{task_id}")
async def remove_task_from_kanban_column(column_id: str, task_id: str):
    """
    Remove a task from a Kanban column.
    """
    db = get_db()
    try:
        entry = (
            db.query(KanbanColumnTask)
            .filter(
                KanbanColumnTask.column_id == column_id,
                KanbanColumnTask.task_id == task_id,
            )
            .first()
        )
        if not entry:
            raise HTTPException(
                status_code=404, detail="Task not found in Kanban column"
            )
        db.delete(entry)
        db.commit()
        return {"detail": "Task removed from Kanban column"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error removing task from Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error removing task from Kanban column: {str(e)}"
        )
    finally:
        db.close()

@router.put("/kanban/columns/{column_id}/tasks/{task_id}/move")
async def move_task_to(column_id: str, task_id: str):
    """
    Move a task to the column in a Kanban column.
    """
    db = get_db()
    try:
        entry = (
            db.query(KanbanColumnTask)
            .filter(KanbanColumnTask.task_id == task_id)
            .first()
        )
        if not entry:
            raise HTTPException(status_code=404, detail="Task not found in any Kanban column")
        entry.column_id = column_id
        db.commit()
        return {"detail": "Task moved to new Kanban column"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error moving task to new Kanban column: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error moving task to new Kanban column: {str(e)}"
        )
    finally:
        db.close()
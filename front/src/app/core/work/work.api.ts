import { inject, Injectable } from '@angular/core';
import type {
  KanbanBoard,
  KanbanBoardSummary,
  TaskDetail,
  TaskSummary,
  TaskUpsert,
} from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Column create/edit body. */
export interface ColumnInput {
  readonly name: string;
  readonly color: string;
  readonly position: number;
}

/** Tasks and kanban boards. */
@Injectable({ providedIn: 'root' })
export class WorkApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Every task (backend filters are broken: filter client-side).
   *
   * @returns Tasks.
   */
  tasks(): Promise<TaskSummary[]> {
    return this.api.get<TaskSummary[]>(backendUrl('/tasks'));
  }

  /**
   * One task with relations.
   *
   * @param id - Task id.
   * @returns Task.
   */
  task(id: string): Promise<TaskDetail> {
    return this.api.get<TaskDetail>(backendUrl(`/tasks/${id}`));
  }

  /**
   * Create a task.
   *
   * @param task - Task.
   * @returns Created task.
   */
  async createTask(task: TaskUpsert): Promise<TaskSummary> {
    const created = await this.api.post<TaskSummary>(backendUrl('/tasks'), task);
    this.sync.invalidate('tasks', 'kanban');
    return created;
  }

  /**
   * Replace a task (relations included).
   *
   * @param id - Task id.
   * @param task - Task.
   */
  async updateTask(id: string, task: TaskUpsert): Promise<void> {
    await this.api.put(backendUrl(`/tasks/${id}`), task);
    this.sync.invalidate('tasks', 'kanban');
  }

  /**
   * Delete a task.
   *
   * @param id - Task id.
   */
  async deleteTask(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/tasks/${id}`));
    this.sync.invalidate('tasks', 'kanban');
  }

  /**
   * Toggle completion (refused while dependencies are open).
   *
   * @param id - Task id.
   */
  async toggleComplete(id: string): Promise<void> {
    await this.api.put(backendUrl(`/tasks/${id}/complete`));
    this.sync.invalidate('tasks', 'kanban');
  }

  /**
   * Boards.
   *
   * @returns Boards.
   */
  boards(): Promise<KanbanBoardSummary[]> {
    return this.api.get<KanbanBoardSummary[]>(backendUrl('/kanban/boards'));
  }

  /**
   * One board with columns and tasks.
   *
   * @param id - Board id.
   * @returns Board.
   */
  board(id: string): Promise<KanbanBoard> {
    return this.api.get<KanbanBoard>(backendUrl(`/kanban/boards/${id}`));
  }

  /**
   * Create a board.
   *
   * @param name - Name.
   * @param description - Description.
   * @returns Created board.
   */
  async createBoard(name: string, description: string): Promise<KanbanBoardSummary> {
    const board = await this.api.post<KanbanBoardSummary>(backendUrl('/kanban/boards'), undefined, {
      params: { name, description },
    });
    this.sync.invalidate('kanban');
    return board;
  }

  /**
   * Edit a board.
   *
   * @param id - Board id.
   * @param name - Name.
   * @param description - Description.
   */
  async updateBoard(id: string, name: string, description: string): Promise<void> {
    await this.api.put(backendUrl(`/kanban/boards/${id}`), undefined, {
      params: { name, description },
    });
    this.sync.invalidate('kanban');
  }

  /**
   * Delete a board.
   *
   * @param id - Board id.
   */
  async deleteBoard(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/kanban/boards/${id}`));
    this.sync.invalidate('kanban');
  }

  /**
   * Add a column.
   *
   * @param boardId - Board id.
   * @param column - Column.
   */
  async createColumn(boardId: string, column: ColumnInput): Promise<void> {
    await this.api.post(backendUrl(`/kanban/boards/${boardId}/columns`), column);
    this.sync.invalidate('kanban');
  }

  /**
   * Edit a column.
   *
   * @param id - Column id.
   * @param column - Column.
   */
  async updateColumn(id: string, column: ColumnInput): Promise<void> {
    await this.api.put(backendUrl(`/kanban/columns/${id}`), column);
    this.sync.invalidate('kanban');
  }

  /**
   * Swap a column with its neighbour.
   *
   * @param id - Column id.
   * @param direction - Left or right.
   */
  async moveColumn(id: string, direction: 'left' | 'right'): Promise<void> {
    await this.api.put(backendUrl(`/kanban/columns/${id}/move/${direction}`));
  }

  /**
   * Delete a column (its tasks are kept).
   *
   * @param id - Column id.
   */
  async deleteColumn(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/kanban/columns/${id}`));
    this.sync.invalidate('kanban');
  }

  /**
   * Put a task in a column.
   *
   * @param columnId - Column id.
   * @param taskId - Task id.
   */
  async addTaskToColumn(columnId: string, taskId: string): Promise<void> {
    await this.api.post(backendUrl(`/kanban/columns/${columnId}/tasks/${taskId}`));
    this.sync.invalidate('kanban');
  }

  /**
   * Move a task to another column.
   *
   * @param columnId - Destination column.
   * @param taskId - Task id.
   */
  async moveTask(columnId: string, taskId: string): Promise<void> {
    await this.api.put(backendUrl(`/kanban/columns/${columnId}/tasks/${taskId}/move`));
  }

  /** Refresh boards after a series of moves. */
  refresh(): void {
    this.sync.invalidate('kanban', 'tasks');
  }
}

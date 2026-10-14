/** Task priorities (backend floats). */
export const TASK_PRIORITIES = [
  { value: -1, label: 'Idea', icon: 'pi pi-lightbulb', color: '#64748b' },
  { value: 0, label: 'Low', icon: 'pi pi-angle-down', color: '#0891b2' },
  { value: 1, label: 'Medium', icon: 'pi pi-minus', color: '#ca8a04' },
  { value: 2, label: 'High', icon: 'pi pi-angle-up', color: '#ea580c' },
  { value: 3, label: 'Critical', icon: 'pi pi-angle-double-up', color: '#dc2626' },
  { value: 4, label: 'Bug', icon: 'pi pi-exclamation-triangle', color: '#9333ea' },
] as const;

/** Task from `GET /tasks` (no relations except dependencies). */
export interface TaskSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly completed: string | null;
  readonly priority: number;
  readonly dependencies: readonly string[];
}

/** Task with relations (`GET /tasks/{id}` and kanban boards). */
export interface TaskDetail extends TaskSummary {
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly files: readonly string[];
  readonly calendars: readonly string[];
  readonly contacts: readonly string[];
}

/** Body of `POST /tasks` and `PUT /tasks/{id}` (PUT replaces relations). */
export interface TaskUpsert {
  readonly title: string;
  readonly description: string | null;
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly files: readonly string[];
  readonly calendars: readonly string[];
  readonly contacts: readonly string[];
  readonly dependencies: readonly string[];
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly priority: number;
}

/** Kanban board summary. */
export interface KanbanBoardSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

/** Kanban column with its tasks. */
export interface KanbanColumn {
  readonly id: string;
  readonly board_id: string;
  readonly name: string;
  readonly color: string;
  readonly position: number;
  readonly tasks: readonly TaskDetail[];
}

/** Kanban board with columns. */
export interface KanbanBoard extends KanbanBoardSummary {
  readonly columns: readonly KanbanColumn[];
}

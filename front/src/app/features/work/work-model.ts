import {
  TASK_PRIORITIES,
  type TaskDetail,
  type TaskSummary,
  type TaskUpsert,
} from '@domain/contracts';
import { daysBetween, parseLocalDate } from '@domain/time';

/** One priority level. */
export type Priority = (typeof TASK_PRIORITIES)[number];

/** Board filters (empty = no filter). */
export interface TaskFilters {
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly priorities: readonly number[];
  readonly showDone: boolean;
}

/** Timeline bucket. */
export interface TimelineGroup {
  readonly key: string;
  readonly label: string;
  readonly tone: 'overdue' | 'today' | 'soon' | 'week' | 'later';
  readonly tasks: readonly TaskDetail[];
}

const ISO_DATE_LENGTH = 10;
const SOON_DAYS = 1;
const WEEK_DAYS = 7;

/**
 * Priority level of a task (unknown values fall back to Low).
 *
 * @param value - Stored priority.
 * @returns Level.
 */
export function priorityOf(value: number): Priority {
  return TASK_PRIORITIES.find((priority) => priority.value === value) ?? TASK_PRIORITIES[1];
}

/**
 * Due day of a task.
 *
 * @param task - Task.
 * @returns `YYYY-MM-DD`, or `null`.
 */
export function dueDay(task: TaskSummary): string | null {
  return task.end_date === null ? null : task.end_date.slice(0, ISO_DATE_LENGTH);
}

/**
 * Whether a task matches the filters.
 *
 * @param task - Task.
 * @param filters - Filters.
 * @returns `true` when visible.
 */
export function matchesFilters(task: TaskDetail, filters: TaskFilters): boolean {
  if (!filters.showDone && task.completed !== null) {
    return false;
  }
  const projectOk =
    filters.projects.length === 0 ||
    task.projects.some((project) => filters.projects.includes(project));
  const tagOk = filters.tags.length === 0 || task.tags.some((tag) => filters.tags.includes(tag));
  const priorityOk = filters.priorities.length === 0 || filters.priorities.includes(task.priority);
  return projectOk && tagOk && priorityOk;
}

/**
 * Open dependencies blocking a task.
 *
 * @param task - Task.
 * @param byId - Every task by id.
 * @returns Blocking tasks.
 */
export function blockersOf(
  task: TaskSummary,
  byId: ReadonlyMap<string, TaskSummary>,
): TaskSummary[] {
  return task.dependencies
    .map((id) => byId.get(id))
    .filter((dependency): dependency is TaskSummary => dependency?.completed === null);
}

/**
 * Tasks that depend (directly or not) on a task: they cannot become its dependencies (cycle).
 *
 * @param taskId - Task id.
 * @param tasks - Every task.
 * @returns Ids of dependents.
 */
export function dependentsOf(taskId: string, tasks: readonly TaskSummary[]): Set<string> {
  const dependents = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const task of tasks) {
      if (
        current !== undefined &&
        task.dependencies.includes(current) &&
        !dependents.has(task.id)
      ) {
        dependents.add(task.id);
        queue.push(task.id);
      }
    }
  }
  return dependents;
}

/**
 * Group tasks with a due date for the timeline (overdue first).
 *
 * @param tasks - Tasks.
 * @param today - Reference day.
 * @returns Groups by due day.
 */
export function timelineGroups(tasks: readonly TaskDetail[], today: Date): TimelineGroup[] {
  const groups = new Map<string, TaskDetail[]>();
  for (const task of tasks) {
    const day = dueDay(task);
    if (day !== null) {
      groups.set(day, [...(groups.get(day) ?? []), task]);
    }
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, list]) => {
      const days = daysBetween(today, parseLocalDate(key) ?? today);
      return { key, ...timelineLabel(days), tasks: list };
    });
}

/**
 * Label and tone of a due date relative to today.
 *
 * @param days - Days until due.
 * @returns Label and tone.
 */
function timelineLabel(days: number): Pick<TimelineGroup, 'label' | 'tone'> {
  if (days < 0) {
    return { label: `${String(-days)} day(s) overdue`, tone: 'overdue' };
  }
  if (days === 0) {
    return { label: 'Today', tone: 'today' };
  }
  if (days <= SOON_DAYS) {
    return { label: 'Tomorrow', tone: 'soon' };
  }
  return days <= WEEK_DAYS
    ? { label: `In ${String(days)} days`, tone: 'week' }
    : { label: `In ${String(days)} days`, tone: 'later' };
}

/**
 * Full replacement body of a task (PUT clears omitted relations upstream).
 *
 * @param task - Existing task.
 * @param patch - Changed fields.
 * @returns Upsert body.
 */
export function toUpsert(task: TaskDetail, patch: Partial<TaskUpsert> = {}): TaskUpsert {
  return {
    title: task.title,
    description: task.description,
    projects: task.projects,
    tags: task.tags,
    files: task.files,
    calendars: task.calendars,
    contacts: task.contacts,
    dependencies: task.dependencies,
    start_date: task.start_date,
    end_date: task.end_date,
    priority: task.priority,
    ...patch,
  };
}

/**
 * Sequence of neighbour swaps moving a column from one index to another.
 *
 * @param from - Current index.
 * @param to - Target index.
 * @returns Directions to apply in order.
 */
export function columnSwaps(from: number, to: number): ('left' | 'right')[] {
  const steps = Math.abs(to - from);
  return Array.from({ length: steps }, () => (to > from ? 'right' : 'left'));
}

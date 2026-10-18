import type { BackendMetrics, DashboardMetrics, NamedCount } from '../contracts/dashboard';
import type { BackendProject, BackendTodoItem, Project, TodoItem } from '../contracts/entities';
import type { BackendLinkTuple, FileLink } from '../contracts/files';

/**
 * Convert backend link tuples into objects (sorted by strength, strongest first).
 *
 * @param tuples - `[other, force, comment]` tuples.
 * @returns Links.
 */
export function toFileLinks(tuples: readonly BackendLinkTuple[]): FileLink[] {
  return tuples
    .map(([other, force, comment]) => ({ other, force, comment: comment ?? '' }))
    .sort((left, right) => right.force - left.force);
}

/**
 * Read one stored TODO item (rows written by the Streamlit grid may lack `Done`).
 *
 * @param value - Candidate.
 * @returns The item, or `null` when it has no task text.
 */
function toTodoItem(value: unknown): TodoItem | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { Done: done, Task: task } = value as Record<string, unknown>;
  return typeof task === 'string' ? { done: done === true, task } : null;
}

/**
 * Parse a project TODO list (JSON string or array) into SPA items.
 *
 * @param raw - Stored TODO value.
 * @returns TODO items (invalid entries dropped).
 */
export function parseTodo(raw: unknown): TodoItem[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw === '' ? '[]' : raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(toTodoItem).filter((item): item is TodoItem => item !== null);
}

/**
 * Convert SPA TODO items to the backend shape.
 *
 * @param items - SPA items.
 * @returns Backend items.
 */
export function toBackendTodo(items: readonly TodoItem[]): BackendTodoItem[] {
  return items.map((item) => ({ Done: item.done, Task: item.task }));
}

/**
 * Normalize a backend project.
 *
 * @param project - Backend project.
 * @returns SPA project.
 */
export function toProject(project: BackendProject): Project {
  return {
    name: project.name,
    description: project.description ?? '',
    color: project.color,
    notes: project.notes ?? '',
    todo: parseTodo(project.todo),
  };
}

/**
 * Convert `[name, count]` pairs to objects.
 *
 * @param pairs - Pairs.
 * @returns Named counts.
 */
function toNamedCounts(pairs: readonly (readonly [string, number])[]): NamedCount[] {
  return pairs.map(([name, count]) => ({ name, count }));
}

/**
 * Normalize `/metrics`.
 *
 * @param metrics - Raw metrics.
 * @returns Dashboard metrics.
 */
export function toDashboardMetrics(metrics: BackendMetrics): DashboardMetrics {
  return {
    counters: {
      files: metrics.nbr_files,
      projects: metrics.nbr_projects,
      tags: metrics.nbr_tags,
      summaries: metrics.nbr_summaries,
      calendarEvents: metrics.nbr_calendars,
      hours: metrics.nbr_hours,
      links: metrics.nbr_links,
      contacts: metrics.nbr_contacts,
      tasks: metrics.nbr_tasks,
      boards: metrics.nbr_kanban_boards,
      validatedTasks: metrics.nbr_validated_tasks,
      filesWithoutTag: metrics.files_without_tag,
      filesWithoutProject: metrics.files_without_project,
    },
    filesPerProject: toNamedCounts(metrics.files_per_project),
    filesPerTag: toNamedCounts(metrics.files_per_tag),
    fileTypes: toNamedCounts(metrics.file_type_counts),
    disk: metrics.disk_usage,
  };
}

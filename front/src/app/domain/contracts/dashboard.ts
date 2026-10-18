import type { CalendarRecord } from './time';
import type { TaskSummary } from './work';

/** Name/count pair. */
export interface NamedCount {
  readonly name: string;
  readonly count: number;
}

/** Disk usage in bytes (`/metrics` → `disk_usage`). */
export interface DiskUsage {
  readonly total: number;
  readonly available: number;
  readonly other: number;
  readonly back: number;
  readonly ollama: number;
  readonly mysql: number;
  readonly files: number;
}

/** Raw `/metrics` response. */
export interface BackendMetrics {
  readonly nbr_calendars: number;
  readonly nbr_hours: number;
  readonly nbr_projects: number;
  readonly nbr_tags: number;
  readonly nbr_files: number;
  readonly nbr_summaries: number;
  readonly nbr_links: number;
  readonly nbr_contacts: number;
  readonly nbr_tasks: number;
  readonly nbr_kanban_boards: number;
  readonly nbr_validated_tasks: number;
  readonly files_per_project: readonly (readonly [string, number])[];
  readonly files_per_tag: readonly (readonly [string, number])[];
  readonly files_without_tag: number;
  readonly files_without_project: number;
  readonly file_type_counts: readonly (readonly [string, number])[];
  readonly disk_usage: DiskUsage;
}

/** Metrics normalized for the Insights view. */
export interface DashboardMetrics {
  readonly counters: {
    readonly files: number;
    readonly projects: number;
    readonly tags: number;
    readonly summaries: number;
    readonly calendarEvents: number;
    readonly hours: number;
    readonly links: number;
    readonly contacts: number;
    readonly tasks: number;
    readonly boards: number;
    readonly validatedTasks: number;
    readonly filesWithoutTag: number;
    readonly filesWithoutProject: number;
  };
  readonly filesPerProject: readonly NamedCount[];
  readonly filesPerTag: readonly NamedCount[];
  readonly fileTypes: readonly NamedCount[];
  readonly disk: DiskUsage;
}

/** Home page data for one day. */
export interface DashboardToday {
  readonly date: string;
  readonly pinned: readonly string[];
  readonly recentAdded: readonly string[];
  readonly recentOpened: readonly string[];
  readonly todayFiles: readonly string[];
  readonly weekFiles: readonly string[];
  readonly todayRecords: readonly CalendarRecord[];
  readonly weekHours: number;
  readonly openTasks: readonly TaskSummary[];
}

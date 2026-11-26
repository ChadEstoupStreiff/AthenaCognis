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

/** Raw `/metrics` → `insights.mail` (trashed and purged messages excluded). */
export interface BackendMailInsights {
  readonly accounts: number;
  readonly received: number;
  readonly unread: number;
  readonly needs_reply: number;
  readonly flagged: number;
  readonly sent: number;
  readonly drafts: number;
  readonly outbox: number;
  readonly outbox_failed: number;
  readonly previews: number;
  readonly vip_senders: number;
  readonly blocked_senders: number;
  readonly per_category: readonly (readonly [string, number])[];
}

/** Raw `/metrics` → `insights` (feature counters). */
export interface BackendInsights {
  readonly usage: {
    readonly nbr_notes: number;
    readonly nbr_pinned_files: number;
    readonly nbr_ocr: number;
    readonly nbr_transcriptions: number;
    readonly nbr_embeddings: number;
    readonly nbr_chat_sessions: number;
    readonly nbr_chat_messages: number;
    readonly nbr_kanban_columns: number;
    readonly nbr_task_dependencies: number;
    readonly nbr_sota_papers: number;
    readonly nbr_sota_with_metadata: number;
    readonly nbr_sota_with_references: number;
  };
  readonly document_trees: number;
  readonly mail: BackendMailInsights;
  readonly activity: {
    readonly generated_days: number;
    readonly generated_entries: number;
    readonly generated_hours: number;
  };
  readonly hours_per_project: readonly (readonly [string, number])[];
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
  /** Missing on backends older than the front. */
  readonly insights?: BackendInsights;
}

/** Feature counters (notes, AI coverage, chat, research, activity generation). */
export interface FeatureCounters {
  readonly notes: number;
  readonly pinned: number;
  readonly ocr: number;
  readonly transcriptions: number;
  readonly embeddings: number;
  readonly documentTrees: number;
  readonly chatSessions: number;
  readonly chatMessages: number;
  readonly boardColumns: number;
  readonly taskDependencies: number;
  readonly papers: number;
  readonly papersWithMetadata: number;
  readonly papersWithReferences: number;
  readonly activityDays: number;
  readonly activityEntries: number;
  readonly activityHours: number;
}

/** Mail client counters. */
export interface MailCounters {
  readonly accounts: number;
  readonly received: number;
  readonly unread: number;
  readonly needsReply: number;
  readonly flagged: number;
  readonly sent: number;
  readonly drafts: number;
  readonly outbox: number;
  readonly outboxFailed: number;
  readonly previews: number;
  readonly vipSenders: number;
  readonly blockedSenders: number;
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
  /** Null when the backend does not report feature counters yet. */
  readonly features: FeatureCounters | null;
  readonly mail: MailCounters | null;
  readonly mailCategories: readonly NamedCount[];
  readonly hoursPerProject: readonly NamedCount[];
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

/** Raw `/daily-text` answer: text of the day from an online provider. */
export interface BackendDailyText {
  readonly text: string;
  /** Empty when none (jokes). */
  readonly author: string;
  readonly provider: string;
}

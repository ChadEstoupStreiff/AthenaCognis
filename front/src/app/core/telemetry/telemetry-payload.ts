import type { BackendMetrics } from '@domain/contracts';
import type { UsageCounts } from './usage-counters';

const HOURS_DECIMALS = 10;
const BYTES_PER_MB = 1_000_000;

/** Base counters (same protocol as the Streamlit front). */
export interface TelemetryPayload {
  readonly nbr_files: number;
  readonly nbr_projects: number;
  readonly nbr_tags: number;
  readonly nbr_calendars: number;
  readonly nbr_hours: number;
  readonly nbr_summaries: number;
  readonly nbr_links: number;
  readonly nbr_contacts: number;
  readonly nbr_tasks: number;
  readonly nbr_kanban_boards: number;
  readonly nbr_validated_tasks: number;
  readonly files_without_tag: number;
  readonly files_without_project: number;
  readonly disk_files_bytes: number;
}

/** Backend `/usage` counters forwarded as-is (whitelist: anything else is dropped). */
export const USAGE_KEYS = [
  'nbr_notes',
  'nbr_pinned_files',
  'nbr_ocr',
  'nbr_transcriptions',
  'nbr_embeddings',
  'nbr_chat_sessions',
  'nbr_chat_messages',
  'nbr_kanban_columns',
  'nbr_task_dependencies',
  'nbr_sota_papers',
  'nbr_sota_with_metadata',
  'nbr_sota_with_references',
] as const;

/** Backend usage counter key. */
export type UsageKey = (typeof USAGE_KEYS)[number];

/** Counters added after the base protocol (all optional on the server). */
export type TelemetryExtras = Partial<Record<UsageKey, number>> &
  UsageCounts & {
    /** 1 when a research subject is written in the settings (never the subject itself). */
    readonly research_subject_set: 0 | 1;
  };

/** Full payload. */
export type FullTelemetryPayload = TelemetryPayload & TelemetryExtras;

/**
 * Build the base payload from backend metrics.
 *
 * @param metrics - `/metrics` response.
 * @returns Counters only (no names, no content; storage rounded to the MB).
 */
export function toTelemetryPayload(metrics: BackendMetrics): TelemetryPayload {
  return {
    nbr_files: metrics.nbr_files,
    nbr_projects: metrics.nbr_projects,
    nbr_tags: metrics.nbr_tags,
    nbr_calendars: metrics.nbr_calendars,
    nbr_hours: Math.round(metrics.nbr_hours * HOURS_DECIMALS) / HOURS_DECIMALS,
    nbr_summaries: metrics.nbr_summaries,
    nbr_links: metrics.nbr_links,
    nbr_contacts: metrics.nbr_contacts,
    nbr_tasks: metrics.nbr_tasks,
    nbr_kanban_boards: metrics.nbr_kanban_boards,
    nbr_validated_tasks: metrics.nbr_validated_tasks,
    files_without_tag: metrics.files_without_tag,
    files_without_project: metrics.files_without_project,
    disk_files_bytes: Math.round(metrics.disk_usage.files / BYTES_PER_MB) * BYTES_PER_MB,
  };
}

/**
 * Keep the known backend usage counters that are non-negative integers.
 *
 * @param raw - `/usage` response (null when unavailable).
 * @returns Counters.
 */
export function toUsageFields(raw: unknown): Partial<Record<UsageKey, number>> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const fields: Partial<Record<UsageKey, number>> = {};
  USAGE_KEYS.forEach((key) => {
    const value = source[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      fields[key] = value;
    }
  });
  return fields;
}

/**
 * Counters added after the base protocol.
 *
 * @param usage - Backend usage response.
 * @param counts - Feature events since the last report.
 * @param subject - Research subject setting.
 * @returns Extras.
 */
export function toTelemetryExtras(
  usage: unknown,
  counts: UsageCounts,
  subject: string,
): TelemetryExtras {
  return {
    ...toUsageFields(usage),
    ...counts,
    research_subject_set: subject.trim() === '' ? 0 : 1,
  };
}

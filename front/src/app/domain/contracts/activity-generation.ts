import type { JobState } from './jobs';

/** Non-editable project holding generated notes and time entries. */
export const ACTIVITY_PROJECT = '⚡ Activity';

/** Time spans an activity summary covers. */
export const GENERATION_SPANS = ['daily', 'weekly', 'monthly'] as const;

/** One time span. */
export type GenerationSpan = (typeof GENERATION_SPANS)[number];

/**
 * Context of a summary: data sources, summaries of the next shorter span (`generated`),
 * or daily summaries (`generated_daily`, monthly only).
 */
export type GenerationBasis = 'generated' | 'generated_daily' | 'sources';

/** What a generation produces; time entries (`time`) for daily generations only. */
export type GenerationOutput = 'summary' | 'time';

/** Generation request (`POST /activity-generation/generate` and `/dry-run`). */
export interface GenerationRequest {
  readonly span: GenerationSpan;
  /** First local day of the period, `YYYY-MM-DD`. */
  readonly day: string;
  /** Local period window as ISO instants. */
  readonly start: string;
  readonly end: string;
  /** Local time minus UTC, in minutes. */
  readonly utc_offset_minutes: number;
  readonly basis: GenerationBasis;
  /** Data source keys, read with the `sources` context. */
  readonly sources: readonly string[];
  /** Custom instruction steering the summary, "" when none. */
  readonly instruction: string;
  /** Monthly from weekly: days no weekly summary covers use their daily summary. */
  readonly fill_daily: boolean;
  /** What to generate; `time` (time entries) for daily requests only. */
  readonly outputs: readonly GenerationOutput[];
}

/** Size of a prompt. */
export interface PromptStats {
  readonly characters: number;
  readonly words: number;
  readonly lines: number;
  /** Characters / 4, rounded up. */
  readonly estimated_tokens: number;
}

/** Kind of a prompt block. */
export type PromptPartKind = 'instructions' | 'source' | 'summary' | 'catalog';

/** Size of one block of the prompt (instructions, a data source, a summary, the catalog). */
export interface PromptPartStat {
  readonly label: string;
  readonly kind: PromptPartKind;
  /** Source blocks: activities read. */
  readonly activities: number;
  /** Why the source could not be read, "" when it was. */
  readonly error: string;
  readonly stats: PromptStats;
}

/** Dry run (`POST /activity-generation/dry-run`): the single prompt, nothing asked nor written. */
export interface GenerationDryRun {
  readonly prompt: string;
  readonly stats: PromptStats;
  readonly parts: readonly PromptPartStat[];
  /** Routed model (`type · model`), "" when unset. */
  readonly model: string;
  /** Context window of the routed model, in tokens. */
  readonly context_tokens: number;
}

/** Latest generation run of a period. */
export interface GenerationRun {
  readonly state: JobState;
  readonly added: string;
  readonly completed: string | null;
  /** What was generated, or why the run failed. */
  readonly result: string | null;
}

/** Generated time entry. */
export interface GeneratedRecord {
  readonly id: string;
  /** Local start, `HH:MM`. */
  readonly start: string | null;
  readonly hours: number;
  readonly title: string;
  readonly description: string;
  /** Projects picked by the AI (the Activity project left out). */
  readonly projects: readonly string[];
  readonly tags: readonly string[];
}

/** What was generated for a period (`GET /activity-generation/{span}/{day}`). */
export interface PeriodGeneration {
  readonly span: GenerationSpan;
  /** First local day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly task: GenerationRun | null;
  readonly note: { readonly path: string; readonly content: string } | null;
  /** Generated time entries (always empty for weekly and monthly). */
  readonly records: readonly GeneratedRecord[];
}

/** What happened to a day: generated, failed, generating, or skipped by the scheduler. */
export type DayState = 'generated' | 'failed' | 'running' | 'skipped';

/** Status of a day (`GET /activity-generation/daily-status`). */
export interface DayStatus {
  /** Local day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Null when never generated nor skipped. */
  readonly state: DayState | null;
  /** Why it was skipped, or why the latest run failed. */
  readonly reason: string | null;
  /** Why the settings make it non working (agenda left out); null for a working day. */
  readonly off: string | null;
}

/** Subdivision codes per two-letter country code (`GET /activity-generation/holiday-countries`). */
export type HolidayCountries = Readonly<Record<string, readonly string[]>>;

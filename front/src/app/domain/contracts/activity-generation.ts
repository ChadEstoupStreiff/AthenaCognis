import type { JobState } from './jobs';

/** Non-editable project holding generated notes and time entries. */
export const ACTIVITY_PROJECT = '⚡ Activity';

/** Time spans an activity summary covers. */
export const GENERATION_SPANS = ['daily', 'weekly', 'monthly'] as const;

/** One time span. */
export type GenerationSpan = (typeof GENERATION_SPANS)[number];

/** What a generation produces. */
export type GenerationOutput = 'summary' | 'time';

/** Daily generation request (`POST /activity-generation/daily`). */
export interface DailyGenerationRequest {
  /** Local day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Local day window as ISO instants. */
  readonly start: string;
  readonly end: string;
  /** Local time minus UTC, in minutes. */
  readonly utc_offset_minutes: number;
  readonly sources: readonly string[];
  readonly outputs: readonly GenerationOutput[];
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

/** What was generated for a day (`GET /activity-generation/daily/{day}`). */
export interface DailyGeneration {
  readonly day: string;
  readonly task: GenerationRun | null;
  readonly note: { readonly path: string; readonly content: string } | null;
  readonly records: readonly GeneratedRecord[];
}

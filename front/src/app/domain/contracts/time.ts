import type { ContactSummary } from './entities';

/** Calendar record as returned by `GET /calendar/search`. */
export interface BackendCalendarRecord {
  readonly id: string;
  readonly project: string;
  readonly date: string;
  /** `1900-01-01THH:MM:SS`, or `null`. */
  readonly start_time: string | null;
  readonly time_spent: number;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly attendees: string | null;
  readonly contacts: readonly ContactSummary[];
}

/** Calendar record as used by the SPA. */
export interface CalendarRecord {
  readonly id: string;
  readonly project: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:MM`, or `null`. */
  readonly startTime: string | null;
  readonly hours: number;
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly attendees: string;
  readonly contacts: readonly ContactSummary[];
}

/** Create/edit body of a calendar record (date and start time are fixed after creation). */
export interface CalendarRecordInput {
  readonly project: string;
  readonly date: string;
  /** `HH:MM`, or `null`. */
  readonly startTime: string | null;
  readonly hours: number;
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly attendees: string;
  readonly contacts: readonly string[];
}

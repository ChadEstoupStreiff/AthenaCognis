import type { DailyGenerationRequest, GenerationOutput, GenerationSpan } from '@domain/contracts';
import { formatLocalDate } from '@domain/time';

/** Local period an activity summary covers, [start, end). */
export interface ActivityPeriod {
  readonly span: GenerationSpan;
  readonly start: Date;
  readonly end: Date;
  /** First day, `YYYY-MM-DD`. */
  readonly key: string;
  readonly label: string;
}

/** When days and weeks start (Activity generation settings). */
export interface PeriodOptions {
  /** Minutes after midnight a day starts. */
  readonly dayStartMinutes: number;
  /** ISO weekday a week starts on (1 = Monday … 7 = Sunday). */
  readonly weekStart: number;
}

/** Days start at midnight, weeks on Monday. */
export const DEFAULT_PERIOD_OPTIONS: PeriodOptions = { dayStartMinutes: 0, weekStart: 1 };

const WEEK_DAYS = 7;
const LOCALE = 'en-GB';
const DAY_LABEL = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const SHORT_DAY = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const MONTH_LABEL = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

/**
 * Local midnight of a day, shifted by a number of days.
 *
 * @param day - Any moment of the day.
 * @param offset - Days to add.
 * @returns Local midnight.
 */
function midnight(day: Date, offset = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
}

/**
 * First day of the week of a day.
 *
 * @param day - Any moment of the week.
 * @param weekStart - ISO weekday weeks start on.
 * @returns Local midnight of that day.
 */
function weekStartOf(day: Date, weekStart: number): Date {
  const first = weekStart % WEEK_DAYS;
  return midnight(day, -((day.getDay() - first + WEEK_DAYS) % WEEK_DAYS));
}

/**
 * Calendar days of the period of a span containing a day.
 *
 * @param span - Time span.
 * @param day - Any day of the period.
 * @param weekStart - ISO weekday weeks start on.
 * @returns First day and the day after the period (local midnights).
 */
function bounds(span: GenerationSpan, day: Date, weekStart: number): [Date, Date] {
  switch (span) {
    case 'daily':
      return [midnight(day), midnight(day, 1)];
    case 'weekly': {
      const first = weekStartOf(day, weekStart);
      return [first, midnight(first, WEEK_DAYS)];
    }
    case 'monthly':
      return [
        new Date(day.getFullYear(), day.getMonth(), 1),
        new Date(day.getFullYear(), day.getMonth() + 1, 1),
      ];
  }
}

/**
 * Moment a day starts.
 *
 * @param day - Local midnight.
 * @param minutes - Minutes after midnight.
 * @returns Local moment.
 */
function atDayStart(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}

/**
 * Label of a period.
 *
 * @param span - Time span.
 * @param start - First day.
 * @param end - Midnight after the period.
 * @returns e.g. "Thursday, 19 November 2026", "16 Nov – 22 Nov 2026", "November 2026".
 */
function labelOf(span: GenerationSpan, start: Date, end: Date): string {
  switch (span) {
    case 'daily':
      return DAY_LABEL.format(start);
    case 'weekly':
      return `${SHORT_DAY.format(start)} – ${SHORT_DAY.format(midnight(end, -1))} ${String(end.getFullYear())}`;
    case 'monthly':
      return MONTH_LABEL.format(start);
  }
}

/**
 * Period of a span containing a calendar day, starting at the configured day start.
 *
 * @param span - Time span.
 * @param day - Any day of the period.
 * @param options - When days and weeks start.
 * @returns Period (key and label from its calendar days).
 */
export function periodOf(
  span: GenerationSpan,
  day: Date,
  options: PeriodOptions = DEFAULT_PERIOD_OPTIONS,
): ActivityPeriod {
  const [first, after] = bounds(span, day, options.weekStart);
  return {
    span,
    start: atDayStart(first, options.dayStartMinutes),
    end: atDayStart(after, options.dayStartMinutes),
    key: formatLocalDate(first),
    label: labelOf(span, first, after),
  };
}

/**
 * Daily generation request of a period.
 *
 * @param period - Daily period.
 * @param sources - Data source keys.
 * @param outputs - What to generate.
 * @returns Request with the local window as instants and the UTC offset.
 */
export function dailyRequest(
  period: ActivityPeriod,
  sources: readonly string[],
  outputs: readonly GenerationOutput[],
): DailyGenerationRequest {
  return {
    day: period.key,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    utc_offset_minutes: -period.start.getTimezoneOffset(),
    sources,
    outputs,
  };
}

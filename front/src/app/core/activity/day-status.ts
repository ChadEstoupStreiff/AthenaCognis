import type { DayState, DayStatus, SettingValue } from '@domain/contracts';
import { formatLocalDate } from '@domain/time';

/** Month shown by the calendar; `month` is 1 (January) … 12. */
export interface ViewMonth {
  readonly year: number;
  readonly month: number;
}

/** Day cell of the PrimeNG calendar; `month` is 0 (January) … 11. */
export interface CalendarCell {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/** Inclusive span of local days, `YYYY-MM-DD`. */
export interface DaySpan {
  readonly first: string;
  readonly last: string;
}

/** Off day settings of the daily schedule. */
export const OFF_DAYS_SETTING = 'activity_generation_daily_off_days';
export const HOLIDAYS_COUNTRY_SETTING = 'activity_generation_daily_holidays_country';
export const HOLIDAYS_SUBDIVISION_SETTING = 'activity_generation_daily_holidays_subdivision';
export const AGENDA_OFF_SETTING = 'activity_generation_daily_agenda_off';
export const AGENDA_KEYWORDS_SETTING = 'activity_generation_daily_agenda_off_keywords';
/** Keywords the backend uses when none are set. */
export const DEFAULT_AGENDA_KEYWORDS = 'vacation, holiday, out of office, OOO, PTO, congé, congés';

/** Days of the neighbour months the calendar shows (at most 6 before, 13 after). */
const DAYS_BEFORE = 7;
const DAYS_AFTER = 14;
const RANGE_SEPARATOR = '/';
const STATE_LABELS: Readonly<Record<DayState, string>> = {
  generated: 'Generated',
  failed: 'Failed',
  running: 'Generating',
  skipped: 'Skipped',
};

/**
 * Month of a day.
 *
 * @param day - Day.
 * @returns Its month.
 */
export function monthOf(day: Date): ViewMonth {
  return { year: day.getFullYear(), month: day.getMonth() + 1 };
}

/**
 * Days a month view of the calendar shows, neighbour month days included.
 *
 * @param view - Shown month.
 * @returns First and last day.
 */
export function visibleSpan(view: ViewMonth): DaySpan {
  return {
    first: formatLocalDate(new Date(view.year, view.month - 1, 1 - DAYS_BEFORE)),
    last: formatLocalDate(new Date(view.year, view.month, DAYS_AFTER)),
  };
}

/**
 * Local day key of a calendar cell.
 *
 * @param cell - Cell.
 * @returns `YYYY-MM-DD`.
 */
export function cellKey(cell: CalendarCell): string {
  return formatLocalDate(new Date(cell.year, cell.month, cell.day));
}

/**
 * Index statuses by day.
 *
 * @param statuses - Statuses.
 * @returns Status per `YYYY-MM-DD`.
 */
export function statusIndex(statuses: readonly DayStatus[]): ReadonlyMap<string, DayStatus> {
  return new Map(statuses.map((status) => [status.day, status]));
}

/**
 * Tooltip of a day: its state, why, and why it is non working.
 *
 * @param status - Status, undefined when unknown.
 * @returns Lines joined, "" when nothing to tell.
 */
export function statusTitle(status: DayStatus | undefined): string {
  if (status === undefined) {
    return '';
  }
  const state = status.state === null ? null : STATE_LABELS[status.state];
  const lines = [
    state !== null && status.reason !== null ? `${state}: ${status.reason}` : state,
    status.off !== null && status.off !== status.reason ? `Non working: ${status.off}` : null,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/**
 * Stored off days and spans.
 *
 * @param value - Stored value.
 * @returns `YYYY-MM-DD` or `YYYY-MM-DD/YYYY-MM-DD` items, sorted.
 */
export function offDays(value: SettingValue | undefined): string[] {
  const items = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  return [...items].sort();
}

/**
 * Stored item of a picked day or span.
 *
 * @param range - Picked dates (PrimeNG range: second null while picking).
 * @returns `YYYY-MM-DD`, `YYYY-MM-DD/YYYY-MM-DD`, or null when nothing picked.
 */
export function offDayItem(range: readonly (Date | null)[] | null): string | null {
  const first = range?.[0] ?? null;
  const last = range?.[1] ?? null;
  if (first === null) {
    return null;
  }
  const start = formatLocalDate(first);
  const end = last === null ? start : formatLocalDate(last);
  return start === end ? start : `${start}${RANGE_SEPARATOR}${end}`;
}

/**
 * Readable label of a stored off day item.
 *
 * @param item - `YYYY-MM-DD` or `YYYY-MM-DD/YYYY-MM-DD`.
 * @returns `YYYY-MM-DD` or `YYYY-MM-DD → YYYY-MM-DD`.
 */
export function offDayLabel(item: string): string {
  return item.split(RANGE_SEPARATOR).join(' → ');
}

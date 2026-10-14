import type { CalendarRecord, NamedCount } from '@domain/contracts';
import { addDays, daysBetween, formatLocalDate, parseLocalDate } from '@domain/time';

/** One cell of the month grid. */
export interface CalendarDay {
  readonly date: string;
  readonly day: number;
  readonly inMonth: boolean;
  readonly weekend: boolean;
}

/** How a past day compares with the daily target. */
export type DayStatus = 'future' | 'today' | 'empty' | 'low' | 'ok' | 'high';

/** Hours per period and project (stacked bar data). */
export interface HoursSeries {
  readonly labels: readonly string[];
  readonly projects: readonly string[];
  readonly values: Readonly<Record<string, readonly number[]>>;
}

/** Progress of a long-running goal (e.g. a PhD). */
export interface GoalProgress {
  readonly total: number;
  readonly passed: number;
  readonly left: number;
  readonly percent: number;
}

const DAYS_PER_WEEK = 7;
const SATURDAY = 6;
const SUNDAY = 0;
const TOLERANCE_HOURS = 1;
const PERCENT = 100;
const MONTH_LENGTH = 7;
const PERIOD_SEPARATOR = '-';
const MONTHS_PER_YEAR = 12;

/**
 * Weeks (Monday first) covering a month.
 *
 * @param year - Year.
 * @param month - Month (0–11).
 * @param weekends - Include Saturday and Sunday.
 * @returns Weeks of days.
 */
export function monthWeeks(year: number, month: number, weekends: boolean): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const start = addDays(first, -((first.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK));
  const weeks: CalendarDay[][] = [];
  for (let cursor = start; cursor.getMonth() === month || cursor < first || weeks.length === 0;) {
    const week: CalendarDay[] = [];
    for (let index = 0; index < DAYS_PER_WEEK; index += 1) {
      const weekend = cursor.getDay() === SATURDAY || cursor.getDay() === SUNDAY;
      if (weekends || !weekend) {
        week.push({
          date: formatLocalDate(cursor),
          day: cursor.getDate(),
          inMonth: cursor.getMonth() === month,
          weekend,
        });
      }
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Status of a day against the daily hour target.
 *
 * @param date - Day.
 * @param hours - Hours logged.
 * @param target - Daily target.
 * @param today - Today.
 * @returns Status.
 */
export function dayStatus(date: string, hours: number, target: number, today: string): DayStatus {
  if (date > today) {
    return 'future';
  }
  if (date === today) {
    return 'today';
  }
  if (hours === 0) {
    return 'empty';
  }
  if (hours > target + TOLERANCE_HOURS) {
    return 'high';
  }
  return hours >= target - TOLERANCE_HOURS ? 'ok' : 'low';
}

/**
 * Group items by a key.
 *
 * @param items - Items.
 * @param keyOf - Key extractor.
 * @returns Groups.
 */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

/**
 * Sum of hours.
 *
 * @param records - Records.
 * @returns Hours.
 */
export function totalHours(records: readonly CalendarRecord[]): number {
  return records.reduce((sum, record) => sum + record.hours, 0);
}

/**
 * Hours per project, largest first.
 *
 * @param records - Records.
 * @returns Project totals.
 */
export function hoursByProject(records: readonly CalendarRecord[]): NamedCount[] {
  return [...groupBy(records, (record) => record.project)]
    .map(([name, list]) => ({ name, count: totalHours(list) }))
    .sort((left, right) => right.count - left.count);
}

/**
 * Period labels between two dates (no gaps).
 *
 * @param start - First day.
 * @param end - Last day.
 * @param granularity - Days or months.
 * @returns Labels (`YYYY-MM-DD` or `YYYY-MM`).
 */
export function periods(start: string, end: string, granularity: 'day' | 'month'): string[] {
  const from = parseLocalDate(start);
  const to = parseLocalDate(end);
  if (from === null || to === null) {
    return [];
  }
  const labels: string[] = [];
  for (let offset = 0; offset <= daysBetween(from, to); offset += 1) {
    const label = formatLocalDate(addDays(from, offset)).slice(
      0,
      granularity === 'day' ? undefined : MONTH_LENGTH,
    );
    if (labels.at(-1) !== label) {
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Hours per period and project, zero-filled.
 *
 * @param records - Records.
 * @param start - First day.
 * @param end - Last day.
 * @param granularity - Days or months.
 * @returns Series.
 */
export function hoursSeries(
  records: readonly CalendarRecord[],
  start: string,
  end: string,
  granularity: 'day' | 'month',
): HoursSeries {
  const labels = periods(start, end, granularity);
  const index = new Map(labels.map((label, position) => [label, position]));
  const projects = hoursByProject(records).map((entry) => entry.name);
  const values: Record<string, number[]> = Object.fromEntries(
    projects.map((project) => [project, labels.map(() => 0)]),
  );
  for (const record of records) {
    const label = granularity === 'day' ? record.date : record.date.slice(0, MONTH_LENGTH);
    const position = index.get(label);
    const series = values[record.project];
    if (position !== undefined && series !== undefined) {
      series[position] = (series[position] ?? 0) + record.hours;
    }
  }
  return { labels, projects, values };
}

/**
 * Progress between two dates.
 *
 * @param start - Start `YYYY-MM-DD`.
 * @param end - End `YYYY-MM-DD`.
 * @param today - Today.
 * @returns Progress, or `null` for invalid dates.
 */
export function goalProgress(start: string, end: string, today: Date): GoalProgress | null {
  const from = parseLocalDate(start);
  const to = parseLocalDate(end);
  if (from === null || to === null || to <= from) {
    return null;
  }
  const total = daysBetween(from, to);
  const passed = Math.min(total, Math.max(0, daysBetween(from, today)));
  return { total, passed, left: total - passed, percent: Math.round((passed / total) * PERCENT) };
}

/**
 * Month key (`YYYY-MM`) of a date.
 *
 * @param year - Year.
 * @param month - Month (0–11).
 * @returns Key.
 */
export function monthKey(year: number, month: number): string {
  return formatLocalDate(new Date(year, month, 1)).slice(0, MONTH_LENGTH);
}

/**
 * Parse a `YYYY-MM` key.
 *
 * @param key - Key.
 * @returns Year and month (0–11), or `null`.
 */
export function parseMonthKey(key: string | undefined): { year: number; month: number } | null {
  const [year, month] = (key ?? '').split(PERIOD_SEPARATOR).map(Number);
  return year !== undefined &&
    month !== undefined &&
    Number.isInteger(year) &&
    month >= 1 &&
    month <= MONTHS_PER_YEAR
    ? { year, month: month - 1 }
    : null;
}

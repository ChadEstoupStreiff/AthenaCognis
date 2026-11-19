/** Preset time windows of the activity feed. */
export const ACTIVITY_RANGES = ['today', 'yesterday', 'week'] as const;

/** One preset window. */
export type ActivityPreset = (typeof ACTIVITY_RANGES)[number];

/** Preset window, or user-picked days. */
export type ActivityRange = ActivityPreset | 'custom';

/** Half-open window [start, end). */
export interface ActivityWindow {
  readonly start: Date;
  readonly end: Date;
}

const WEEK_DAYS = 7;

/**
 * Local midnight of a day, shifted by a number of days.
 *
 * @param day - Any moment of the day.
 * @param offset - Days to add.
 * @returns Local midnight.
 */
function midnight(day: Date, offset: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
}

/**
 * Local-time window of a preset.
 *
 * @param range - Preset.
 * @param now - Current moment.
 * @returns Window from local midnight to local midnight.
 */
export function activityWindow(range: ActivityPreset, now: Date = new Date()): ActivityWindow {
  switch (range) {
    case 'today':
      return { start: midnight(now, 0), end: midnight(now, 1) };
    case 'yesterday':
      return { start: midnight(now, -1), end: midnight(now, 0) };
    case 'week':
      return { start: midnight(now, 1 - WEEK_DAYS), end: midnight(now, 1) };
  }
}

/**
 * Local-time window covering whole days, both ends included.
 *
 * @param first - Any moment of the first day.
 * @param last - Any moment of the last day; earlier than first swaps them.
 * @returns Window from first-day midnight to the midnight after the last day.
 */
export function customWindow(first: Date, last: Date): ActivityWindow {
  const [from, to] = first <= last ? [first, last] : [last, first];
  return { start: midnight(from, 0), end: midnight(to, 1) };
}

/**
 * Days of the default custom range: the 7-day preset.
 *
 * @param now - Current moment.
 * @returns First and last day.
 */
export function defaultCustomDays(now: Date = new Date()): [Date, Date] {
  return [midnight(now, 1 - WEEK_DAYS), midnight(now, 0)];
}

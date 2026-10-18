const PAD_LENGTH = 2;
const MONTH_OFFSET = 1;
const ISO_DATE_LENGTH = 10;
const DAY_IN_MS = 86_400_000;

/**
 * Pad a number to two digits.
 *
 * @param value - Number to pad.
 * @returns The zero-padded string.
 */
function pad(value: number): string {
  return String(value).padStart(PAD_LENGTH, '0');
}

/**
 * Format a date as `YYYY-MM-DD` in the local timezone (the backend expects local dates).
 *
 * @param date - Date to format.
 * @returns The local calendar date.
 */
export function formatLocalDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + MONTH_OFFSET)}-${pad(date.getDate())}`;
}

/**
 * Format a time as `HH-MM-SS` (used in generated file names).
 *
 * @param date - Date holding the time.
 * @returns The local time with dashes.
 */
export function formatFileTime(date: Date): string {
  return `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Parse a `YYYY-MM-DD` string as a local date at midnight.
 *
 * @param isoDate - Date string (extra time part is ignored).
 * @returns The local date, or `null` when the string is not a valid date.
 */
export function parseLocalDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.slice(0, ISO_DATE_LENGTH));
  if (match === null) {
    return null;
  }
  const [, year, month, day] = match.map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }
  const date = new Date(year, month - MONTH_OFFSET, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Shift a date by a number of days.
 *
 * @param date - Starting date.
 * @param days - Days to add (negative to subtract).
 * @returns A new date.
 */
export function addDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/**
 * Count whole days between two local dates.
 *
 * @param from - Start date.
 * @param to - End date.
 * @returns `to - from` in days (rounded).
 */
export function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / DAY_IN_MS);
}

import { Pipe, type PipeTransform } from '@angular/core';
import { daysBetween, parseLocalDate } from '@domain/time';

const WEEK = 7;
const FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Describe a date relative to today (`Today`, `Yesterday`, `3 days ago`, or a date).
 *
 * @param isoDate - `YYYY-MM-DD` (time part ignored).
 * @param today - Reference date.
 * @returns Label.
 */
export function relativeDateLabel(isoDate: string, today: Date = new Date()): string {
  const date = parseLocalDate(isoDate);
  if (date === null) {
    return isoDate;
  }
  const delta = daysBetween(date, today);
  if (delta === 0) {
    return 'Today';
  }
  if (delta === 1) {
    return 'Yesterday';
  }
  if (delta > 1 && delta < WEEK) {
    return `${String(delta)} days ago`;
  }
  return FORMAT.format(date);
}

/** Template pipe for {@link relativeDateLabel}. */
@Pipe({ name: 'relativeDate' })
export class RelativeDatePipe implements PipeTransform {
  /**
   * Format a date relative to today.
   *
   * @param isoDate - Date string.
   * @returns Label.
   */
  transform(isoDate: string | null | undefined): string {
    return isoDate === null || isoDate === undefined ? '' : relativeDateLabel(isoDate);
  }
}

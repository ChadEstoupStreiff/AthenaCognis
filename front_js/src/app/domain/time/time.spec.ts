import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatFileTime, formatLocalDate, parseLocalDate } from './index';

describe('time helpers', () => {
  it('formats local dates and times', () => {
    const date = new Date(2026, 0, 5, 7, 8, 9);
    expect(formatLocalDate(date)).toBe('2026-01-05');
    expect(formatFileTime(date)).toBe('07-08-09');
  });

  it('parses local dates', () => {
    expect(parseLocalDate('2026-02-03T10:00:00')?.getDate()).toBe(3);
    expect(parseLocalDate('nope')).toBeNull();
  });

  it('adds and counts days', () => {
    const start = new Date(2026, 2, 28);
    expect(formatLocalDate(addDays(start, 5))).toBe('2026-04-02');
    expect(daysBetween(start, addDays(start, 10))).toBe(10);
  });
});

import { ACTIVITY_PROJECT, type CalendarRecord } from '@domain/contracts';
import {
  dayStatus,
  goalProgress,
  hoursByProject,
  hoursSeries,
  monthWeeks,
  parseMonthKey,
  periods,
  projectShares,
  NO_PROJECT,
  withoutActivityProject,
} from './time-model';

const record = (
  date: string,
  project: string,
  hours: number,
  projects: readonly string[] = [project],
): CalendarRecord => ({
  id: `${date}${project}`,
  project,
  projects,
  tags: [],
  date,
  startTime: null,
  hours,
  title: 't',
  description: '',
  location: '',
  attendees: '',
  contacts: [],
});

describe('time model', () => {
  it('builds Monday-first weeks covering the month', () => {
    const weeks = monthWeeks(2026, 9, true);
    expect(weeks[0]?.[0]).toMatchObject({ date: '2026-09-28', inMonth: false });
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(31);
    expect(monthWeeks(2026, 9, false).every((week) => week.length === 5)).toBe(true);
  });

  it('rates days against the target', () => {
    expect(dayStatus('2026-10-20', 0, 7.5, '2026-10-14')).toBe('future');
    expect(dayStatus('2026-10-14', 0, 7.5, '2026-10-14')).toBe('today');
    expect(dayStatus('2026-10-13', 0, 7.5, '2026-10-14')).toBe('empty');
    expect(dayStatus('2026-10-13', 7, 7.5, '2026-10-14')).toBe('ok');
    expect(dayStatus('2026-10-13', 9, 7.5, '2026-10-14')).toBe('high');
    expect(dayStatus('2026-10-13', 3, 7.5, '2026-10-14')).toBe('low');
  });

  it('aggregates hours', () => {
    const records = [
      record('2026-10-01', 'A', 2),
      record('2026-10-03', 'A', 1),
      record('2026-11-01', 'B', 5),
    ];
    expect(hoursByProject(records)).toEqual([
      { name: 'B', count: 5 },
      { name: 'A', count: 3 },
    ]);
    expect(periods('2026-10-30', '2026-11-02', 'month')).toEqual(['2026-10', '2026-11']);
    const daily = hoursSeries(records, '2026-10-01', '2026-10-03', 'day');
    expect(daily.labels).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(daily.values['A']).toEqual([2, 0, 1]);
  });

  it('computes goal progress and month keys', () => {
    expect(goalProgress('2026-01-01', '2026-01-11', new Date(2026, 0, 6))).toEqual({
      total: 10,
      passed: 5,
      left: 5,
      percent: 50,
    });
    expect(goalProgress('bad', '2026-01-11', new Date())).toBeNull();
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey('2026-13')).toBeNull();
  });

  it('splits multi-project hours evenly in project totals and series', () => {
    const shared = record('2026-10-01', 'A', 2, ['A', 'B']);
    expect(projectShares(shared)).toEqual([
      ['A', 1],
      ['B', 1],
    ]);
    expect(hoursByProject([shared, record('2026-10-02', 'A', 1)])).toEqual([
      { name: 'A', count: 2 },
      { name: 'B', count: 1 },
    ]);
    const series = hoursSeries([shared], '2026-10-01', '2026-10-01', 'day');
    expect(series.values['B']).toEqual([1]);
  });

  it('keeps Activity entries in stats without the Activity project', () => {
    const generated = record('2026-10-01', ACTIVITY_PROJECT, 3, [ACTIVITY_PROJECT, 'A']);
    const alone = record('2026-10-02', ACTIVITY_PROJECT, 2, [ACTIVITY_PROJECT]);
    const real = record('2026-10-01', 'A', 1);
    const kept = withoutActivityProject([generated, alone, real]);
    expect(kept.map((entry) => entry.projects)).toEqual([['A'], [NO_PROJECT], ['A']]);
    expect(hoursByProject(kept)).toEqual([
      { name: 'A', count: 4 },
      { name: NO_PROJECT, count: 2 },
    ]);
  });
});

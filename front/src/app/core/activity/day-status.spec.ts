import {
  cellKey,
  monthOf,
  offDayItem,
  offDayLabel,
  offDays,
  statusIndex,
  statusTitle,
  visibleSpan,
} from './day-status';

describe('day status', () => {
  it('spans the days a month view shows', () => {
    expect(monthOf(new Date(2026, 10, 23))).toEqual({ year: 2026, month: 11 });
    expect(visibleSpan({ year: 2026, month: 1 })).toEqual({
      first: '2025-12-25',
      last: '2026-02-14',
    });
  });

  it('keys calendar cells (0-based months)', () => {
    expect(cellKey({ year: 2026, month: 0, day: 5 })).toBe('2026-01-05');
  });

  it('tells state, reason and non working reason', () => {
    const index = statusIndex([
      { day: '2026-11-21', state: 'failed', reason: 'No activity.', off: 'Saturday not picked' },
      {
        day: '2026-11-22',
        state: 'skipped',
        reason: 'Sunday not picked',
        off: 'Sunday not picked',
      },
      { day: '2026-11-23', state: 'generated', reason: null, off: null },
      { day: '2026-11-24', state: null, reason: null, off: null },
    ]);
    expect(statusTitle(index.get('2026-11-21'))).toBe(
      'Failed: No activity.\nNon working: Saturday not picked',
    );
    expect(statusTitle(index.get('2026-11-22'))).toBe('Skipped: Sunday not picked');
    expect(statusTitle(index.get('2026-11-23'))).toBe('Generated');
    expect(statusTitle(index.get('2026-11-24'))).toBe('');
    expect(statusTitle(undefined)).toBe('');
  });

  it('reads and builds off day items', () => {
    expect(offDays(['2026-12-24', 3, '2026-08-01/2026-08-15'])).toEqual([
      '2026-08-01/2026-08-15',
      '2026-12-24',
    ]);
    expect(offDays(null)).toEqual([]);
    expect(offDayItem([new Date(2026, 7, 1), new Date(2026, 7, 15)])).toBe('2026-08-01/2026-08-15');
    expect(offDayItem([new Date(2026, 11, 24), null])).toBe('2026-12-24');
    expect(offDayItem(null)).toBeNull();
    expect(offDayLabel('2026-08-01/2026-08-15')).toBe('2026-08-01 → 2026-08-15');
  });
});

import { clockMinutes, periodOptions, scheduleDefaults, spanSetting } from './generation-settings';

describe('generation settings', () => {
  it('reads clock values', () => {
    expect(clockMinutes('04:30')).toBe(270);
    expect(clockMinutes('25:00')).toBe(0);
    expect(clockMinutes(undefined)).toBe(0);
  });

  it('reads period options with defaults', () => {
    expect(periodOptions({})).toEqual({ dayStartMinutes: 0, weekStart: 1 });
    expect(
      periodOptions({ activity_generation_day_start: '05:00', activity_generation_week_start: 7 }),
    ).toEqual({ dayStartMinutes: 300, weekStart: 7 });
    expect(periodOptions({ activity_generation_week_start: 9 }).weekStart).toBe(1);
  });

  it('reads schedule defaults of a span', () => {
    expect(scheduleDefaults({}, 'daily')).toEqual({
      basis: 'generated',
      sources: [],
      outputs: ['summary', 'time'],
    });
    const values = {
      [spanSetting('weekly', 'basis')]: 'sources',
      [spanSetting('weekly', 'sources')]: ['github'],
      [spanSetting('weekly', 'outputs')]: ['time', 'bogus'],
    };
    expect(scheduleDefaults(values, 'weekly')).toEqual({
      basis: 'sources',
      sources: ['github'],
      outputs: ['time'],
    });
  });
});

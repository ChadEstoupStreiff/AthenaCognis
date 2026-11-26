import {
  DAILY_WEEKDAY_OPTIONS,
  clockMinutes,
  contextOptions,
  offersFillWithDaily,
  periodOptions,
  scheduleDefaults,
  spanSetting,
} from './generation-settings';

describe('generation settings', () => {
  it('offers daily weekdays with the backend codes, Monday first', () => {
    expect(DAILY_WEEKDAY_OPTIONS.map((option) => option.value)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
  });

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
      basis: 'sources',
      fillWithDaily: false,
      sources: [],
      instruction: '',
    });
    const values = {
      [spanSetting('weekly', 'basis')]: 'sources',
      [spanSetting('weekly', 'sources')]: ['github'],
      [spanSetting('weekly', 'instruction')]: 'In French.',
      [spanSetting('monthly', 'instruction')]: 3,
    };
    expect(scheduleDefaults(values, 'weekly')).toEqual({
      basis: 'sources',
      fillWithDaily: false,
      sources: ['github'],
      instruction: 'In French.',
    });
    expect(scheduleDefaults(values, 'monthly').instruction).toBe('');
  });

  it('offers daily summaries as monthly context only', () => {
    expect(contextOptions('daily')).toEqual([]);
    expect(contextOptions('weekly').map((option) => option.value)).toEqual([
      'generated',
      'sources',
    ]);
    expect(contextOptions('monthly').map((option) => option.label)).toEqual([
      'Use generated weekly',
      'Use generated daily',
      'Select data sources',
    ]);
  });

  it('reads monthly daily context and fill toggle', () => {
    const values = {
      [spanSetting('monthly', 'basis')]: 'generated_daily',
      [spanSetting('monthly', 'fill_daily')]: true,
      [spanSetting('weekly', 'basis')]: 'generated_daily',
    };
    expect(scheduleDefaults(values, 'monthly')).toMatchObject({
      basis: 'generated_daily',
      fillWithDaily: true,
    });
    expect(scheduleDefaults(values, 'weekly').basis).toBe('generated');
  });

  it('offers the fill toggle for monthly from weekly only', () => {
    expect(offersFillWithDaily('monthly', 'generated')).toBe(true);
    expect(offersFillWithDaily('monthly', 'generated_daily')).toBe(false);
    expect(offersFillWithDaily('weekly', 'generated')).toBe(false);
  });
});

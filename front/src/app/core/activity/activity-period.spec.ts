import { generationRequest, periodOf } from './activity-period';

describe('periodOf', () => {
  const thursday = new Date(2026, 10, 19, 15, 30);

  it('covers one local day', () => {
    const period = periodOf('daily', thursday);
    expect(period.start).toEqual(new Date(2026, 10, 19));
    expect(period.end).toEqual(new Date(2026, 10, 20));
    expect(period.key).toBe('2026-11-19');
    expect(period.label).toBe('Thursday, 19 November 2026');
  });

  it('covers Monday to Sunday, across months', () => {
    const period = periodOf('weekly', new Date(2026, 11, 2));
    expect(period.start).toEqual(new Date(2026, 10, 30));
    expect(period.end).toEqual(new Date(2026, 11, 7));
    expect(period.label).toBe('30 Nov – 6 Dec 2026');
  });

  it('keeps a Sunday in the week that started on Monday', () => {
    expect(periodOf('weekly', new Date(2026, 10, 22)).key).toBe('2026-11-16');
  });

  it('covers a calendar month', () => {
    const period = periodOf('monthly', thursday);
    expect(period.start).toEqual(new Date(2026, 10, 1));
    expect(period.end).toEqual(new Date(2026, 11, 1));
    expect(period.label).toBe('November 2026');
  });
});

describe('generationRequest', () => {
  const context = {
    basis: 'sources',
    fillWithDaily: true,
    sources: ['github'],
    instruction: ' Brief ',
  } as const;

  it('sends the local day as instants with its UTC offset', () => {
    const period = periodOf('daily', new Date(2026, 10, 19, 9));
    const request = generationRequest(period, context);
    expect(request.span).toBe('daily');
    expect(request.day).toBe('2026-11-19');
    expect(new Date(request.start)).toEqual(period.start);
    expect(new Date(request.end)).toEqual(period.end);
    expect(request.utc_offset_minutes).toBe(-period.start.getTimezoneOffset());
    expect(request.sources).toEqual(['github']);
    expect(request.instruction).toBe('Brief');
    expect(request.fill_daily).toBe(false);
  });

  it('drops sources from generated contexts', () => {
    const period = periodOf('monthly', new Date(2026, 10, 19));
    const request = generationRequest(period, { ...context, basis: 'generated' });
    expect(request.day).toBe('2026-11-01');
    expect(request.sources).toEqual([]);
    expect(request.fill_daily).toBe(true);
  });
});

describe('periodOf with options', () => {
  it('starts days at the configured time', () => {
    const period = periodOf('daily', new Date(2026, 10, 19), {
      dayStartMinutes: 270,
      weekStart: 1,
    });
    expect(period.start).toEqual(new Date(2026, 10, 19, 4, 30));
    expect(period.end).toEqual(new Date(2026, 10, 20, 4, 30));
    expect(period.key).toBe('2026-11-19');
  });

  it('starts weeks on the configured weekday', () => {
    const period = periodOf('weekly', new Date(2026, 10, 19), { dayStartMinutes: 0, weekStart: 7 });
    expect(period.start).toEqual(new Date(2026, 10, 15));
    expect(period.end).toEqual(new Date(2026, 10, 22));
    expect(period.label).toBe('15 Nov – 21 Nov 2026');
  });
});

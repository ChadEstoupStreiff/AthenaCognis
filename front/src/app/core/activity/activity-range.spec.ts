import { activityWindow, customWindow, defaultCustomDays } from './activity-range';

describe('activityWindow', () => {
  const now = new Date(2026, 10, 18, 14, 30);

  it('covers today from local midnight to next midnight', () => {
    const window = activityWindow('today', now);
    expect(window.start).toEqual(new Date(2026, 10, 18));
    expect(window.end).toEqual(new Date(2026, 10, 19));
  });

  it('covers the whole of yesterday', () => {
    const window = activityWindow('yesterday', now);
    expect(window.start).toEqual(new Date(2026, 10, 17));
    expect(window.end).toEqual(new Date(2026, 10, 18));
  });

  it('covers the last seven days including today, across months', () => {
    const window = activityWindow('week', new Date(2026, 11, 3, 9));
    expect(window.start).toEqual(new Date(2026, 10, 27));
    expect(window.end).toEqual(new Date(2026, 11, 4));
  });
});

describe('customWindow', () => {
  it('covers both picked days entirely', () => {
    const window = customWindow(new Date(2026, 10, 3, 15), new Date(2026, 10, 5, 8));
    expect(window.start).toEqual(new Date(2026, 10, 3));
    expect(window.end).toEqual(new Date(2026, 10, 6));
  });

  it('covers one day when both ends match', () => {
    const day = new Date(2026, 10, 3);
    expect(customWindow(day, day)).toEqual({ start: day, end: new Date(2026, 10, 4) });
  });

  it('swaps reversed ends', () => {
    const window = customWindow(new Date(2026, 10, 5), new Date(2026, 10, 3));
    expect(window.start).toEqual(new Date(2026, 10, 3));
    expect(window.end).toEqual(new Date(2026, 10, 6));
  });
});

describe('defaultCustomDays', () => {
  it('matches the 7-day preset', () => {
    const now = new Date(2026, 10, 18, 14, 30);
    const [first, last] = defaultCustomDays(now);
    expect(customWindow(first, last)).toEqual(activityWindow('week', now));
  });
});

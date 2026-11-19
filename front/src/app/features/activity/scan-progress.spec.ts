import type { ScanProgress } from '@domain/contracts';
import { clock, progressLine, scanPercent } from './scan-progress';

/**
 * Build a progress with defaults.
 *
 * @param changes - Fields to set.
 * @returns Progress.
 */
function progress(changes: Partial<ScanProgress>): ScanProgress {
  return {
    running: true,
    desc: '',
    done: 0,
    total: 0,
    unit: '',
    items: 0,
    item_unit: '',
    elapsed: 0,
    ...changes,
  };
}

describe('scanPercent', () => {
  it('rounds done over total', () => {
    expect(scanPercent(progress({ done: 1, total: 3 }))).toBe(33);
  });

  it('is 0 without a total and capped at 100', () => {
    expect(scanPercent(progress({}))).toBe(0);
    expect(scanPercent(progress({ running: false, done: 5, total: 4 }))).toBe(100);
  });
});

describe('clock', () => {
  it('formats minutes and seconds, hours when needed', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(75.4)).toBe('01:15');
    expect(clock(3725)).toBe('1:02:05');
  });
});

describe('progressLine', () => {
  it('reads like a tqdm caption', () => {
    const line = progressLine(
      progress({
        desc: 'Scanning',
        done: 2,
        total: 5,
        unit: 'folders',
        items: 1234,
        item_unit: 'files',
        elapsed: 4,
      }),
    );
    expect(line).toBe('Scanning 40% 2/5 folders [00:04<00:06, 0.50 folders/s] · 1,234 files');
  });

  it('shows unknown remaining time and pace before the first step', () => {
    const line = progressLine(progress({ desc: 'Reading calendars', total: 3, unit: 'calendars' }));
    expect(line).toBe('Reading calendars 0% 0/3 calendars [00:00<?, ? calendars/s]');
  });
});

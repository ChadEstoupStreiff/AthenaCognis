import { scanPercent } from './scan-progress';

describe('scanPercent', () => {
  it('rounds done over total', () => {
    expect(scanPercent({ running: true, done: 1, total: 3, files: 10 })).toBe(33);
  });

  it('is 0 without a total and capped at 100', () => {
    expect(scanPercent({ running: true, done: 0, total: 0, files: 0 })).toBe(0);
    expect(scanPercent({ running: false, done: 5, total: 4, files: 0 })).toBe(100);
  });
});

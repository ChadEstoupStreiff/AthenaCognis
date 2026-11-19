import { signal } from '@angular/core';
import { latestValue, type ValueSource } from './latest-value';

describe('latestValue', () => {
  it('keeps the last value while the source reloads', () => {
    const value = signal<string[] | undefined>(undefined);
    const source: ValueSource<string[]> = { hasValue: () => value() !== undefined, value };
    const latest = latestValue(source, []);
    expect(latest()).toEqual([]);
    value.set(['a']);
    expect(latest()).toEqual(['a']);
    value.set(undefined);
    expect(latest()).toEqual(['a']);
    value.set(['b']);
    expect(latest()).toEqual(['b']);
  });
});

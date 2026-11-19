import { readSourceCount, saveSourceCount } from './source-count';

describe('source count', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults before any visit', () => {
    expect(readSourceCount()).toBe(4);
  });

  it('reads back the saved count, zero included', () => {
    saveSourceCount(7);
    expect(readSourceCount()).toBe(7);
    saveSourceCount(0);
    expect(readSourceCount()).toBe(0);
  });

  it('ignores a corrupt value', () => {
    localStorage.setItem('ac.activity.source-count', 'abc');
    expect(readSourceCount()).toBe(4);
  });
});

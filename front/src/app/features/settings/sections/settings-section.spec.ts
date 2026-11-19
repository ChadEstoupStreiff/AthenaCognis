import { sameItems } from './settings-section';

describe('sameItems', () => {
  it('compares content and order, not references', () => {
    expect(sameItems(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameItems(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameItems(['a'], ['a', 'b'])).toBe(false);
    expect(sameItems([], [])).toBe(true);
  });
});

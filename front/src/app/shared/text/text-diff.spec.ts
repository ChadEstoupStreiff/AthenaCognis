import { describe, expect, it } from 'vitest';
import { diffLines } from './text-diff';

describe('diffLines', () => {
  it('tags kept, removed and added lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('returns only same lines for identical texts', () => {
    expect(diffLines('a\nb', 'a\nb').every((line) => line.kind === 'same')).toBe(true);
  });
});

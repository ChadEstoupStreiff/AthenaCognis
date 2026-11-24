import { describe, expect, it } from 'vitest';
import { searchEmojis } from './emoji';

describe('searchEmojis', () => {
  it('ranks prefix matches first and limits results', () => {
    const results = searchEmojis('ro', 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results[0]?.name.startsWith('ro')).toBe(true);
  });

  it('finds inner matches', () => {
    expect(searchEmojis('check', 10).map((emoji) => emoji.char)).toContain('✅');
  });
});

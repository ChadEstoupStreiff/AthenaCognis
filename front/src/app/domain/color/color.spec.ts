import { describe, expect, it } from 'vitest';
import {
  colorForName,
  FALLBACK_PALETTE,
  fnv1a,
  normalizeHexColor,
  readableTextColor,
} from './index';

describe('color helpers', () => {
  it('hashes deterministically', () => {
    expect(fnv1a('Research')).toBe(fnv1a('Research'));
    expect(fnv1a('')).toBe(0x811c9dc5);
  });

  it('picks a palette color', () => {
    expect(FALLBACK_PALETTE).toContain(colorForName('🌀 Other'));
  });

  it('normalizes hex colors', () => {
    expect(normalizeHexColor('FF0000')).toBe('#ff0000');
    expect(normalizeHexColor('#00ff00')).toBe('#00ff00');
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });

  it('chooses readable text', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000');
    expect(readableTextColor('#7700a7')).toBe('#ffffff');
    expect(readableTextColor('bogus')).toBe('#000000');
  });
});

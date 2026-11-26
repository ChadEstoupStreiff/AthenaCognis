import { TestBed } from '@angular/core/testing';
import { accentPalette, DEFAULT_APPEARANCE, parseAppearance, surfacePalettes } from './appearance';
import { AppearanceService } from './appearance.service';
import { BRAND_PALETTE } from './athena-preset';

describe('parseAppearance', () => {
  it('returns defaults for missing or broken data', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{oops')).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps valid fields and drops invalid ones', () => {
    const prefs = parseAppearance(
      JSON.stringify({ fontScale: 1.25, fontFamily: 'comic', accent: '#2563EB', surface: 'lava' }),
    );
    expect(prefs).toEqual({
      fontScale: 1.25,
      fontFamily: 'inter',
      accent: '#2563eb',
      surface: 'default',
    });
  });
});

describe('palettes', () => {
  it('keeps the hand-tuned brand palette for the default accent', () => {
    expect(accentPalette(DEFAULT_APPEARANCE.accent)).toBe(BRAND_PALETTE);
    expect(accentPalette('#2563eb')['500']).toBe('#2563eb');
  });

  it('pairs slate and zinc by default, one tone otherwise', () => {
    expect(surfacePalettes('default').light['50']).toBe('#f8fafc');
    expect(surfacePalettes('default').dark['50']).toBe('#fafafa');
    expect(surfacePalettes('stone').dark['950']).toBe('#0c0a09');
  });
});

describe('AppearanceService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies font variables and persists changes', () => {
    const appearance = TestBed.inject(AppearanceService);
    appearance.update({ fontScale: 1.1, fontFamily: 'serif' });
    TestBed.tick();
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--ac-font-scale')).toBe('1.1');
    expect(style.getPropertyValue('--ac-font-family')).toContain('Georgia');
    expect(parseAppearance(localStorage.getItem('athena.appearance')).fontScale).toBe(1.1);
    appearance.reset();
    TestBed.tick();
    expect(style.getPropertyValue('--ac-font-scale')).toBe('1');
  });
});

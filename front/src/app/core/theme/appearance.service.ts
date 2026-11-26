import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';
import { updatePreset, updatePrimaryPalette } from '@primeuix/themes';
import {
  accentPalette,
  type AppearancePrefs,
  DEFAULT_APPEARANCE,
  FONT_STACKS,
  parseAppearance,
  surfacePalettes,
} from './appearance';

const STORAGE_KEY = 'athena.appearance';
const FONT_SCALE_VAR = '--ac-font-scale';
const FONT_FAMILY_VAR = '--ac-font-family';

/** Font size, font, accent and surface customization, persisted per browser. */
@Injectable({ providedIn: 'root' })
export class AppearanceService {
  private readonly document = inject(DOCUMENT);

  /** Current preferences. */
  readonly prefs = signal<AppearancePrefs>(this.readStored());

  /** Apply and persist preferences on every change. */
  constructor() {
    let applied: AppearancePrefs = DEFAULT_APPEARANCE;
    effect(() => {
      const prefs = this.prefs();
      this.applyFonts(prefs);
      if (prefs.accent !== applied.accent) {
        updatePrimaryPalette(accentPalette(prefs.accent));
      }
      if (prefs.surface !== applied.surface) {
        this.applySurface(prefs);
      }
      applied = prefs;
      this.writeStored(prefs);
    });
  }

  /**
   * Change some preferences.
   *
   * @param patch - Fields to change.
   */
  update(patch: Partial<AppearancePrefs>): void {
    this.prefs.update((prefs) => ({ ...prefs, ...patch }));
  }

  /** Restore the default look. */
  reset(): void {
    this.prefs.set(DEFAULT_APPEARANCE);
  }

  /**
   * Swap the PrimeNG surface palettes of both color schemes.
   *
   * @param prefs - Preferences.
   */
  private applySurface(prefs: AppearancePrefs): void {
    const { light, dark } = surfacePalettes(prefs.surface);
    updatePreset({
      semantic: { colorScheme: { light: { surface: light }, dark: { surface: dark } } },
    });
  }

  /**
   * Set the font CSS variables on `<html>`.
   *
   * @param prefs - Preferences.
   */
  private applyFonts(prefs: AppearancePrefs): void {
    const style = this.document.documentElement.style;
    style.setProperty(FONT_SCALE_VAR, String(prefs.fontScale));
    style.setProperty(FONT_FAMILY_VAR, FONT_STACKS[prefs.fontFamily]);
  }

  /**
   * Read the persisted preferences (storage may be unavailable).
   *
   * @returns Stored preferences or defaults.
   */
  private readStored(): AppearancePrefs {
    try {
      return parseAppearance(this.document.defaultView?.localStorage.getItem(STORAGE_KEY) ?? null);
    } catch {
      return DEFAULT_APPEARANCE;
    }
  }

  /**
   * Persist preferences (ignored when storage is unavailable).
   *
   * @param prefs - Preferences.
   */
  private writeStored(prefs: AppearancePrefs): void {
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Private mode or blocked storage: the look simply is not remembered.
    }
  }
}

import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { DARK_MODE_CLASS } from './athena-preset';

/** User-selectable color scheme. */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'athena.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Narrow a stored string to a theme mode.
 *
 * @param value - Stored value.
 * @returns The mode, or `system` when unknown.
 */
function asThemeMode(value: string | null): ThemeMode {
  return MODES.find((mode) => mode === value) ?? 'system';
}

/** Light/dark/system theme switching, persisted per browser. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.mediaQuery(DARK_QUERY);
  private readonly systemDark = signal(this.media?.matches ?? false);

  /** Current mode. */
  readonly mode = signal<ThemeMode>(this.readStoredMode());

  /** Whether dark colors are in use. */
  readonly dark = computed(
    () => this.mode() === 'dark' || (this.mode() === 'system' && this.systemDark()),
  );

  /** Wire the `<html>` class to the mode and the OS preference. */
  constructor() {
    this.media?.addEventListener('change', (event) => {
      this.systemDark.set(event.matches);
    });
    let isFirstRun = true;
    effect(() => {
      const dark = this.dark();
      if (isFirstRun) {
        isFirstRun = false;
        this.applyDarkClass(dark);
      } else {
        this.transitionTo(dark);
      }
      this.writeStoredMode(this.mode());
    });
  }

  /** Cycle light → dark → system. */
  cycle(): void {
    const index = MODES.indexOf(this.mode());
    this.mode.set(MODES[(index + 1) % MODES.length] ?? 'system');
  }

  /**
   * Cross-fade to the new scheme with the View Transitions API (instant when unsupported or reduced motion).
   *
   * @param dark - Whether dark colors should be used.
   */
  private transitionTo(dark: boolean): void {
    const reducedMotion = this.mediaQuery(REDUCED_MOTION_QUERY)?.matches ?? false;
    if (reducedMotion || typeof this.document.startViewTransition !== 'function') {
      this.applyDarkClass(dark);
      return;
    }
    this.document.startViewTransition(() => {
      this.applyDarkClass(dark);
    });
  }

  /**
   * Toggle the dark class on `<html>`.
   *
   * @param dark - Whether dark colors should be used.
   */
  private applyDarkClass(dark: boolean): void {
    this.document.documentElement.classList.toggle(DARK_MODE_CLASS, dark);
  }

  /**
   * Watch an OS media preference (absent in some embedded browsers and test DOMs).
   *
   * @param query - Media query to match.
   * @returns The media query list, or `null`.
   */
  private mediaQuery(query: string): MediaQueryList | null {
    const view = this.document.defaultView;
    return view !== null && typeof view.matchMedia === 'function' ? view.matchMedia(query) : null;
  }

  /**
   * Read the persisted mode (storage may be unavailable).
   *
   * @returns The stored mode or `system`.
   */
  private readStoredMode(): ThemeMode {
    try {
      return asThemeMode(this.document.defaultView?.localStorage.getItem(STORAGE_KEY) ?? null);
    } catch {
      return 'system';
    }
  }

  /**
   * Persist the mode (ignored when storage is unavailable).
   *
   * @param mode - Mode to store.
   */
  private writeStoredMode(mode: ThemeMode): void {
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private mode or blocked storage: the theme simply is not remembered.
    }
  }
}

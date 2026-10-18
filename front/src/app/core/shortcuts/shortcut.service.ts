import { DestroyRef, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { CaptureService } from '../capture/capture.service';
import { MAIN_NAV, SETTINGS_NAV } from '../layout/nav-items';
import { PaletteService } from '../layout/palette.service';

const SEQUENCE_TIMEOUT_MS = 1_200;

/**
 * Check whether the user is typing (shortcuts must not fire then).
 *
 * @param target - Event target.
 * @returns `true` inside inputs, text areas, selects and editors.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('.cm-editor') !== null
  );
}

/** Global keyboard shortcuts: ⌘K/Ctrl+K palette, `g <key>` navigation, `u` upload, `v` voice memo. */
@Injectable({ providedIn: 'root' })
export class ShortcutService {
  private readonly router = inject(Router);
  private readonly palette = inject(PaletteService);
  private readonly capture = inject(CaptureService);
  private pendingG = 0;

  /** Install the window listener (call once from the shell). */
  install(): void {
    const listener = (event: KeyboardEvent): void => {
      this.handle(event);
    };
    window.addEventListener('keydown', listener);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('keydown', listener);
    });
  }

  /**
   * Dispatch one key press.
   *
   * @param event - Key event.
   */
  private handle(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.palette.toggle();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
      return;
    }
    if (Date.now() - this.pendingG < SEQUENCE_TIMEOUT_MS) {
      this.pendingG = 0;
      this.jump(event.key);
      return;
    }
    this.single(event);
  }

  /**
   * Single-key shortcuts.
   *
   * @param event - Key event.
   */
  private single(event: KeyboardEvent): void {
    switch (event.key) {
      case 'g':
        this.pendingG = Date.now();
        return;
      case '/':
        event.preventDefault();
        this.palette.open.set(true);
        return;
      case 'u':
        this.capture.openUpload();
        return;
      case 'v':
        this.capture.openVoice();
        return;
      default:
        return;
    }
  }

  /**
   * Navigate with `g <key>`.
   *
   * @param key - Second key.
   */
  private jump(key: string): void {
    const item = [...MAIN_NAV, SETTINGS_NAV].find((candidate) => candidate.shortcut === key);
    if (item !== undefined) {
      void this.router.navigate([item.route]);
    }
  }
}

import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { SettingValue } from '@domain/contracts';
import { NotifyService } from '../../core/notify/notify.service';
import { SettingsStore } from '../../core/settings/settings.store';

const DEBOUNCE_MS = 600;

/** Debounced, per-key setting writes with a "saved" indicator. */
@Injectable()
export class SettingsWriter {
  private readonly settings = inject(SettingsStore);
  private readonly notify = inject(NotifyService);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, SettingValue>();

  /** Keys being saved. */
  readonly saving = signal<ReadonlySet<string>>(new Set());
  /** Last saved key (for a transient indicator). */
  readonly lastSaved = signal<string | null>(null);

  /** Flush pending writes when the page closes. */
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const key of [...this.pending.keys()]) {
        void this.flush(key);
      }
    });
  }

  /**
   * Current value of a setting.
   *
   * @param key - Key.
   * @returns Pending or stored value.
   */
  value(key: string): SettingValue | undefined {
    return this.pending.has(key) ? this.pending.get(key) : this.settings.values()[key];
  }

  /**
   * Schedule a write.
   *
   * @param key - Key.
   * @param value - Value.
   * @param immediate - Write now (toggles, selects).
   */
  set(key: string, value: SettingValue, immediate = false): void {
    this.pending.set(key, value);
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (immediate) {
      void this.flush(key);
      return;
    }
    this.timers.set(
      key,
      setTimeout(() => void this.flush(key), DEBOUNCE_MS),
    );
  }

  /**
   * Write one pending key.
   *
   * @param key - Key.
   */
  private async flush(key: string): Promise<void> {
    if (!this.pending.has(key)) {
      return;
    }
    const value = this.pending.get(key) ?? null;
    this.pending.delete(key);
    this.timers.delete(key);
    this.saving.update((keys) => new Set([...keys, key]));
    try {
      await this.settings.set(key, value);
      this.lastSaved.set(key);
    } catch {
      this.notify.error(`Could not save “${key}”.`);
    } finally {
      this.saving.update((keys) => new Set([...keys].filter((item) => item !== key)));
    }
  }
}

import { inject } from '@angular/core';
import type { SettingValue } from '@domain/contracts';
import { SettingsWriter } from '../settings-writer';

/**
 * Whether two lists hold the same items in the same order.
 *
 * @param left - First list.
 * @param right - Second list.
 * @returns True when equal.
 */
export function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Shared helpers of settings sections (typed reads, debounced writes). */
export abstract class SettingsSection {
  protected readonly writer = inject(SettingsWriter);

  /** Last list returned per setting: the same array while unchanged (see {@link stableList}). */
  private readonly lastLists = new Map<string, readonly string[]>();

  /**
   * Numeric setting.
   *
   * @param key - Key.
   * @param fallback - Default.
   * @returns Value.
   */
  protected num(key: string, fallback = 0): number {
    const value = this.writer.value(key);
    return typeof value === 'number' ? value : fallback;
  }

  /**
   * Text setting.
   *
   * @param key - Key.
   * @param fallback - Default.
   * @returns Value.
   */
  protected text(key: string, fallback = ''): string {
    const value = this.writer.value(key);
    return typeof value === 'string' ? value : fallback;
  }

  /**
   * Boolean setting.
   *
   * @param key - Key.
   * @returns Value.
   */
  protected flag(key: string): boolean {
    return this.writer.value(key) === true;
  }

  /**
   * Save a setting.
   *
   * @param key - Key.
   * @param value - Value.
   * @param immediate - Skip the debounce.
   */
  protected save(key: string, value: SettingValue, immediate = false): void {
    this.writer.set(key, value, immediate);
  }

  /**
   * List setting with a stable reference.
   *
   * Returns the previous array when the content is unchanged: a new array on every change
   * detection makes ngModel rewrite the multiselect, which schedules another detection (freeze).
   *
   * @param key - Setting key.
   * @param fallback - Value when unset.
   * @returns Strings of the setting.
   */
  protected stableList(key: string, fallback: readonly string[]): readonly string[] {
    const value = this.writer.value(key);
    const next = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : fallback;
    const last = this.lastLists.get(key);
    if (last !== undefined && sameItems(next, last)) {
      return last;
    }
    this.lastLists.set(key, next);
    return next;
  }
}

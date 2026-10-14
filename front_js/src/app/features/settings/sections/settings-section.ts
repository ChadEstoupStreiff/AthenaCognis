import { inject } from '@angular/core';
import type { SettingValue } from '@domain/contracts';
import { SettingsWriter } from '../settings-writer';

/** Shared helpers of settings sections (typed reads, debounced writes). */
export abstract class SettingsSection {
  protected readonly writer = inject(SettingsWriter);

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
}

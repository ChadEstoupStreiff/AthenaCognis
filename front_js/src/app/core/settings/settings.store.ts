import { computed, inject, Injectable, resource } from '@angular/core';
import { guardSettingValue, type SettingValue } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Settings read by several pages, with their types. */
interface KnownSettings {
  readonly search_default_timeframe_days: number;
  readonly semantic_similarity_threshold: number;
  readonly auto_display_file_size_limit: number;
  readonly target_hourly_working_time: number;
  readonly explorer_default_representation_mode: number;
  readonly projects_default_representation_mode: number;
  readonly enable_auto_preview: boolean;
}

/** Defaults (mirror `back/src/views/settings.py`). */
export const SETTING_DEFAULTS: KnownSettings = {
  search_default_timeframe_days: 30,
  semantic_similarity_threshold: 0.4,
  auto_display_file_size_limit: 10,
  target_hourly_working_time: 7.5,
  explorer_default_representation_mode: 1,
  projects_default_representation_mode: 1,
  enable_auto_preview: true,
};

/** Keys with typed defaults. */
export type KnownSettingKey = keyof KnownSettings;

/** Application settings (shared with the Streamlit front: same keys, same encoding). */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /** Every setting (stored values merged over backend defaults). */
  readonly snapshot = resource({
    params: () => this.sync.version('settings')(),
    loader: ({ abortSignal }) =>
      this.api.get<Record<string, SettingValue>>(backendUrl('/settings'), { signal: abortSignal }),
  });

  /** Raw values (empty while loading). */
  readonly values = computed<Readonly<Record<string, SettingValue>>>(() =>
    this.snapshot.hasValue() ? this.snapshot.value() : {},
  );

  /**
   * Typed value of a known setting.
   *
   * @param key - Setting key.
   * @returns Stored value, or the default when unset or of the wrong type.
   */
  get<K extends KnownSettingKey>(key: K): KnownSettings[K] {
    const fallback = SETTING_DEFAULTS[key];
    const value = this.values()[key];
    return typeof value === typeof fallback ? (value as KnownSettings[K]) : fallback;
  }

  /**
   * Store a setting and refresh the snapshot.
   *
   * @param key - Setting key.
   * @param value - New value.
   */
  async set(key: string, value: SettingValue): Promise<void> {
    await this.api.post(backendUrl(`/settings/${encodeURIComponent(key)}`), {
      value: guardSettingValue(value),
    });
    this.sync.invalidate('settings');
  }
}

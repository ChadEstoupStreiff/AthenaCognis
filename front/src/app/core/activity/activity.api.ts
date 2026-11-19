import { inject, Injectable } from '@angular/core';
import type { ActivityItem, DataSourceInfo, FolderEntry, ScanProgress } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';
import type { ActivityWindow } from './activity-range';

/**
 * URL of one source.
 *
 * @param key - Source key.
 * @returns Backend URL.
 */
function sourceUrl(key: string): string {
  return backendUrl(`/activity/sources/${encodeURIComponent(key)}`);
}

/** Activity data sources, their lifecycle and their time-ranged feeds. */
@Injectable({ providedIn: 'root' })
export class ActivityApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Every data source with its state.
   *
   * @returns Sources.
   */
  sources(): Promise<DataSourceInfo[]> {
    return this.api.get<DataSourceInfo[]>(backendUrl('/activity/sources'));
  }

  /**
   * Add a set-up source to the Activity page, enabled.
   *
   * @param key - Source key.
   * @returns Updated source.
   */
  async add(key: string): Promise<DataSourceInfo> {
    const source = await this.api.post<DataSourceInfo>(sourceUrl(key), undefined);
    this.sync.invalidate('settings');
    return source;
  }

  /**
   * Enable or disable an added source.
   *
   * @param key - Source key.
   * @param enabled - New state.
   * @returns Updated source.
   */
  async setEnabled(key: string, enabled: boolean): Promise<DataSourceInfo> {
    const source = await this.api.patch<DataSourceInfo>(sourceUrl(key), { enabled });
    this.sync.invalidate('settings');
    return source;
  }

  /**
   * Remove a source from the Activity page and reset its settings.
   *
   * @param key - Source key.
   * @returns Updated source.
   */
  async remove(key: string): Promise<DataSourceInfo> {
    const source = await this.api.delete<DataSourceInfo>(sourceUrl(key));
    this.sync.invalidate('settings');
    return source;
  }

  /**
   * Subfolders of a folder, for the folder picker of a source.
   *
   * @param key - Source key.
   * @param path - Folder relative to the source root ('' for the root).
   * @returns Subfolders.
   */
  folders(key: string, path: string): Promise<FolderEntry[]> {
    return this.api.get<FolderEntry[]>(`${sourceUrl(key)}/folders`, { params: { path } });
  }

  /**
   * Progress of the feed being collected (silent: polled while a feed loads).
   *
   * @param key - Source key.
   * @returns Progress, idle when the source has no long scan.
   */
  progress(key: string): Promise<ScanProgress> {
    return this.api.get<ScanProgress>(`${sourceUrl(key)}/progress`, { silent: true });
  }

  /**
   * Activities of one source in a window, newest first.
   *
   * @param key - Source key.
   * @param window - Time window.
   * @returns Activities.
   */
  feed(key: string, window: ActivityWindow): Promise<ActivityItem[]> {
    return this.api.get<ActivityItem[]>(`${sourceUrl(key)}/feed`, {
      params: { start: window.start.toISOString(), end: window.end.toISOString() },
    });
  }
}

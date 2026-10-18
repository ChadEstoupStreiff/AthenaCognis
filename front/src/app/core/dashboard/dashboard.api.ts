import { inject, Injectable } from '@angular/core';
import type {
  BackendCalendarRecord,
  BackendMetrics,
  DashboardMetrics,
  DashboardToday,
  TaskSummary,
} from '@domain/contracts';
import { toCalendarRecord, toDashboardMetrics } from '@domain/mappers';
import { addDays, formatLocalDate, parseLocalDate } from '@domain/time';
import { ApiClient, backendUrl, type RequestOptions } from '../api/api-client';

const METRICS_CACHE_MS = 300_000;
const WEEK_DAYS = 6;

/** Home page data. */
@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private readonly api = inject(ApiClient);
  private metricsCache: { readonly at: number; readonly value: Promise<DashboardMetrics> } | null =
    null;

  /**
   * Files, records and open tasks of a day and the six days before.
   *
   * @param date - Local date.
   * @param signal - Abort signal.
   * @returns Home data.
   */
  async today(date: string, signal?: AbortSignal): Promise<DashboardToday> {
    const day = parseLocalDate(date) ?? new Date();
    const weekStart = formatLocalDate(addDays(day, -WEEK_DAYS));
    const options = signal ? { signal } : {};
    const [pinned, recentAdded, recentOpened, weekFiles, weekRecords, tasks] = await Promise.all([
      this.api.get<string[]>(backendUrl('/pinned'), options),
      this.optionalList(backendUrl('/stockpile/recentadded'), options),
      this.optionalList(backendUrl('/stockpile/recentopened'), options),
      this.api.get<string[]>(backendUrl('/files/search'), {
        ...options,
        params: { start_date: weekStart, end_date: date, search_mode: 0 },
      }),
      this.api.get<BackendCalendarRecord[]>(backendUrl('/calendar/search'), {
        ...options,
        params: { start_date: weekStart, end_date: date },
      }),
      this.api.get<TaskSummary[]>(backendUrl('/tasks'), options),
    ]);
    const records = weekRecords.map(toCalendarRecord);
    return {
      date,
      pinned,
      recentAdded,
      recentOpened,
      todayFiles: weekFiles.filter((path) => path.split('/')[2] === date),
      weekFiles,
      todayRecords: records.filter((record) => record.date === date),
      weekHours: records.reduce((sum, record) => sum + record.hours, 0),
      openTasks: tasks.filter((task) => task.completed === null && task.end_date !== null),
    };
  }

  /**
   * Counters and distributions (`/metrics` walks the disk: cached five minutes).
   *
   * @param refresh - Bypass the cache.
   * @returns Metrics.
   */
  metrics(refresh: boolean): Promise<DashboardMetrics> {
    const now = Date.now();
    if (refresh || this.metricsCache === null || now - this.metricsCache.at > METRICS_CACHE_MS) {
      const value = this.api.get<BackendMetrics>(backendUrl('/metrics')).then(toDashboardMetrics);
      this.metricsCache = { at: now, value };
      value.catch(() => {
        this.metricsCache = null;
      });
    }
    return this.metricsCache.value;
  }

  /**
   * A recents list (the backend answers 500 before the list exists).
   *
   * @param url - List URL.
   * @param options - Request options (abort signal).
   * @returns The list, or empty.
   */
  private async optionalList(url: string, options: RequestOptions): Promise<string[]> {
    try {
      return await this.api.get<string[]>(url, { ...options, silent: true });
    } catch {
      return [];
    }
  }
}

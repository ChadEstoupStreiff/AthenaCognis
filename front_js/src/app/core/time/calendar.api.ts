import { inject, Injectable } from '@angular/core';
import type { BackendCalendarRecord, CalendarRecord, CalendarRecordInput } from '@domain/contracts';
import { toCalendarRecord } from '@domain/mappers';
import { ApiClient, backendUrl, type QueryParams } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Calendar search filters. */
export interface CalendarQuery {
  readonly start: string;
  readonly end: string;
  readonly project?: string | null;
  readonly text?: string | null;
}

const SECONDS_SUFFIX = ':00';

/**
 * Query parameters shared by create and edit.
 *
 * @param input - Record input.
 * @returns Parameters.
 */
function recordParams(input: CalendarRecordInput): QueryParams {
  return {
    title: input.title.trim(),
    project: input.project,
    time_spent: input.hours,
    description: input.description,
    location: input.location,
    attendees: input.attendees,
    contacts: JSON.stringify(input.contacts),
  };
}

/** Time entries (calendar records). */
@Injectable({ providedIn: 'root' })
export class CalendarApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Records in a date range.
   *
   * @param query - Filters.
   * @param signal - Abort signal.
   * @returns Records, newest first.
   */
  async search(query: CalendarQuery, signal?: AbortSignal): Promise<CalendarRecord[]> {
    const records = await this.api.get<BackendCalendarRecord[]>(backendUrl('/calendar/search'), {
      params: {
        start_date: query.start,
        end_date: query.end,
        project: query.project ?? null,
        query: query.text ?? null,
      },
      ...(signal ? { signal } : {}),
    });
    return records.map(toCalendarRecord);
  }

  /**
   * Create a record. The backend returns nothing, so the new record is found by diffing the day's ids.
   *
   * @param input - Record.
   * @returns The created record, or `null` if it cannot be read back.
   */
  async create(input: CalendarRecordInput): Promise<CalendarRecord | null> {
    const day = { start: input.date, end: input.date, project: input.project };
    const before = new Set((await this.search(day)).map((record) => record.id));
    await this.api.post(backendUrl('/calendar/record'), undefined, {
      params: {
        ...recordParams(input),
        date: input.date,
        start_time: input.startTime === null ? null : input.startTime + SECONDS_SUFFIX,
      },
    });
    this.sync.invalidate('calendar');
    return (await this.search(day)).find((record) => !before.has(record.id)) ?? null;
  }

  /**
   * Edit a record (date and start time are fixed by the backend).
   *
   * @param id - Record id.
   * @param input - New values.
   */
  async update(id: string, input: CalendarRecordInput): Promise<void> {
    await this.api.put(backendUrl(`/calendar/record/${encodeURIComponent(id)}`), undefined, {
      params: recordParams(input),
    });
    this.sync.invalidate('calendar');
  }

  /**
   * Delete a record.
   *
   * @param id - Record id.
   */
  async delete(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/calendar/record/${encodeURIComponent(id)}`));
    this.sync.invalidate('calendar');
  }
}

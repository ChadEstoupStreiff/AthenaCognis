import type { BackendCalendarRecord, CalendarRecord } from '../contracts/time';

const ISO_DATE_LENGTH = 10;
const TIME_PATTERN = /T(\d{2}:\d{2})/;

/**
 * Normalize a backend calendar record.
 *
 * @param record - Backend record.
 * @returns SPA record.
 */
export function toCalendarRecord(record: BackendCalendarRecord): CalendarRecord {
  return {
    id: record.id,
    project: record.project,
    date: record.date.slice(0, ISO_DATE_LENGTH),
    startTime: TIME_PATTERN.exec(record.start_time ?? '')?.[1] ?? null,
    hours: record.time_spent,
    title: record.title,
    description: record.description ?? '',
    location: record.location ?? '',
    attendees: record.attendees ?? '',
    contacts: record.contacts,
  };
}

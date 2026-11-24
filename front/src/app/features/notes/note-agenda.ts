import type { ActivityItem } from '@domain/contracts';

/** Key of the agenda data source. */
export const AGENDA_SOURCE = 'agenda';

const ALL_DAY_KIND = 'all_day';
const UTC_SUFFIX = 'Z';
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

/**
 * Local time of a naive-UTC activity timestamp.
 *
 * @param occurredAt - ISO datetime without zone (UTC).
 * @returns Local date.
 */
function localTime(occurredAt: string): Date {
  return new Date(
    /[zZ]|[+-]\d\d:?\d\d$/.test(occurredAt) ? occurredAt : `${occurredAt}${UTC_SUFFIX}`,
  );
}

/**
 * One agenda line.
 *
 * @param item - Agenda event.
 * @returns Markdown list item.
 */
function agendaLine(item: ActivityItem): string {
  const when =
    item.kind === ALL_DAY_KIND
      ? 'All day'
      : localTime(item.occurred_at).toLocaleTimeString([], TIME_OPTIONS);
  const duration = item.details['duration'];
  const location = item.details['location'];
  const extras = [duration, location].filter((value) => value !== undefined && value !== '');
  return `- **${when}** ${item.title}${extras.length > 0 ? ` _(${extras.join(', ')})_` : ''}`;
}

/**
 * Agenda of a day as Markdown (all-day events first, then by time).
 *
 * @param items - Agenda events.
 * @param day - Day `YYYY-MM-DD`.
 * @returns Markdown block.
 */
export function agendaMarkdown(items: readonly ActivityItem[], day: string): string {
  const sorted = [...items].sort((left, right) => {
    const allDay = Number(right.kind === ALL_DAY_KIND) - Number(left.kind === ALL_DAY_KIND);
    return allDay !== 0
      ? allDay
      : localTime(left.occurred_at).getTime() - localTime(right.occurred_at).getTime();
  });
  const lines = sorted.length === 0 ? ['_No events._'] : sorted.map(agendaLine);
  return [`### 📅 Agenda — ${day}`, '', ...lines].join('\n');
}

import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '@domain/contracts';
import { agendaMarkdown } from './note-agenda';

/**
 * Agenda item.
 *
 * @param title - Title.
 * @param kind - Kind.
 * @param occurredAt - Naive UTC time.
 * @returns Item.
 */
function item(title: string, kind: string, occurredAt: string): ActivityItem {
  return {
    id: title,
    source: 'agenda',
    kind,
    occurred_at: occurredAt,
    title,
    summary: '',
    actors: [],
    link: null,
    details: { duration: '1 h' },
    ai_context: '',
  };
}

describe('agendaMarkdown', () => {
  it('lists all-day events first, then by time', () => {
    const markdown = agendaMarkdown(
      [
        item('Late', 'event', '2026-11-24T15:00:00'),
        item('Early', 'event', '2026-11-24T08:00:00'),
        item('Holiday', 'all_day', '2026-11-24T00:00:00'),
      ],
      '2026-11-24',
    );
    const lines = markdown.split('\n');
    expect(lines[0]).toBe('### 📅 Agenda — 2026-11-24');
    expect(lines[2]).toContain('All day');
    expect(lines[3]).toContain('Early');
    expect(lines[4]).toContain('Late _(1 h)_');
  });

  it('says when the day is empty', () => {
    expect(agendaMarkdown([], '2026-11-24')).toContain('_No events._');
  });
});

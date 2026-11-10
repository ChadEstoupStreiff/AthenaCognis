import type { BackendMetrics } from '@domain/contracts';
import { toTelemetryExtras, toTelemetryPayload, toUsageFields } from './telemetry-payload';
import { emptyCounts, parseCounts, subtractCounts } from './usage-counters';

const METRICS = {
  nbr_calendars: 1,
  nbr_hours: 12.345,
  nbr_projects: 2,
  nbr_tags: 3,
  nbr_files: 4,
  nbr_summaries: 5,
  nbr_links: 6,
  nbr_contacts: 7,
  nbr_tasks: 8,
  nbr_kanban_boards: 9,
  nbr_validated_tasks: 10,
  files_per_project: [['Secret project', 4]],
  files_per_tag: [['Secret tag', 4]],
  files_without_tag: 1,
  files_without_project: 2,
  file_type_counts: [['.pdf', 4]],
  disk_usage: { files: 123_456_789 },
} as unknown as BackendMetrics;

describe('telemetry payload', () => {
  it('sends counters only, never project, tag or file type names', () => {
    const payload = toTelemetryPayload(METRICS);
    expect(JSON.stringify(payload)).not.toMatch(/Secret|\.pdf/);
    expect(Object.values(payload).every((value) => typeof value === 'number')).toBe(true);
    expect(payload.nbr_hours).toBe(12.3);
    expect(payload.disk_files_bytes).toBe(123_000_000);
  });

  it('forwards only whitelisted non-negative integer usage counters', () => {
    expect(
      toUsageFields({
        nbr_notes: 3,
        nbr_ocr: -1,
        nbr_chat_messages: 2.5,
        nbr_sota_papers: '4',
        subject: 'my secret subject',
      }),
    ).toEqual({ nbr_notes: 3 });
    expect(toUsageFields(null)).toEqual({});
  });

  it('reports whether a subject is set, never the subject', () => {
    const extras = toTelemetryExtras(null, emptyCounts(), '  tumor segmentation ');
    expect(extras.research_subject_set).toBe(1);
    expect(JSON.stringify(extras)).not.toContain('tumor');
    expect(toTelemetryExtras(null, emptyCounts(), '   ').research_subject_set).toBe(0);
  });
});

describe('usage counters', () => {
  it('parses stored counts defensively', () => {
    expect(parseCounts('{"research_searches":2,"research_imports":-3,"query":"x"}')).toEqual({
      ...emptyCounts(),
      research_searches: 2,
    });
    expect(parseCounts('not json')).toEqual(emptyCounts());
    expect(parseCounts(null)).toEqual(emptyCounts());
  });

  it('keeps events counted while a report was being sent', () => {
    const sent = { ...emptyCounts(), research_searches: 2 };
    const now = { ...emptyCounts(), research_searches: 3, research_imports: 1 };
    expect(subtractCounts(now, sent)).toEqual({
      ...emptyCounts(),
      research_searches: 1,
      research_imports: 1,
    });
  });
});

import type { GeneratedRecord } from '@domain/contracts';
import { isGenerating, noteBody, recordRange } from './generation-model';

/**
 * Build a time entry.
 *
 * @param start - Start clock.
 * @param hours - Length.
 * @returns Entry.
 */
function record(start: string | null, hours: number): GeneratedRecord {
  return { id: '1', start, hours, title: 'Work', description: '', projects: [], tags: [] };
}

describe('recordRange', () => {
  it('adds the length to the start', () => {
    expect(recordRange(record('09:00', 1.5))).toBe('09:00 – 10:30');
    expect(recordRange(record('23:30', 1))).toBe('23:30 – 00:30');
  });

  it('shows the length alone without start', () => {
    expect(recordRange(record(null, 2))).toBe('2 h');
  });
});

describe('isGenerating', () => {
  it('is true while queued or running only', () => {
    const run = { added: '', completed: null, result: null };
    expect(isGenerating({ ...run, state: 'PENDING' })).toBe(true);
    expect(isGenerating({ ...run, state: 'IN_PROGRESS' })).toBe(true);
    expect(isGenerating({ ...run, state: 'FAILED' })).toBe(false);
    expect(isGenerating(null)).toBe(false);
  });
});

describe('noteBody', () => {
  it('drops the generated title', () => {
    expect(noteBody('# ⚡ Daily activity — 2026-11-19\n\nDid things.\n')).toBe('Did things.\n');
  });
});

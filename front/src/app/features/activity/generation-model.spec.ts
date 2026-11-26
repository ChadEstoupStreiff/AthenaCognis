import { isGenerating, noteBody } from './generation-model';

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

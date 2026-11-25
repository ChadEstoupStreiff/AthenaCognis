import { describe, expect, it } from 'vitest';
import { filterNotes, groupNotesByDay, splitPinned } from './note-list';

const OLD = '/shared/2026-10-01/notes/meeting.md';
const NEW_A = '/shared/2026-11-25/notes/2026-11-25_09-00-00.md';
const NEW_B = '/shared/2026-11-25/notes/2026-11-25_14-30-00.md';
const IDEAS = '/shared/2026-11-03/notes/Project Ideas.md';

describe('filterNotes', () => {
  it('keeps everything for an empty query', () => {
    expect(filterNotes([OLD, IDEAS], '  ')).toEqual([OLD, IDEAS]);
  });

  it('matches name words case-insensitively', () => {
    expect(filterNotes([OLD, IDEAS, NEW_A], 'project IDEAS')).toEqual([IDEAS]);
  });

  it('matches the day', () => {
    expect(filterNotes([OLD, IDEAS, NEW_A], '2026-10')).toEqual([OLD]);
  });

  it('requires every word', () => {
    expect(filterNotes([OLD, IDEAS], 'meeting ideas')).toEqual([]);
  });
});

describe('groupNotesByDay', () => {
  it('sorts days and names newest first', () => {
    expect(groupNotesByDay([OLD, NEW_A, IDEAS, NEW_B])).toEqual([
      { day: '2026-11-25', paths: [NEW_B, NEW_A] },
      { day: '2026-11-03', paths: [IDEAS] },
      { day: '2026-10-01', paths: [OLD] },
    ]);
  });
});

describe('splitPinned', () => {
  it('moves pinned notes out, sorted by name', () => {
    expect(splitPinned([OLD, NEW_A, IDEAS, NEW_B], new Set([OLD, IDEAS, '/shared/x.md']))).toEqual({
      pinned: [OLD, IDEAS],
      others: [NEW_A, NEW_B],
    });
  });

  it('keeps everything unpinned without pins', () => {
    expect(splitPinned([OLD, IDEAS], new Set())).toEqual({ pinned: [], others: [OLD, IDEAS] });
  });
});

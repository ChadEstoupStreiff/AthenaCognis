import type { TaskDetail } from '@domain/contracts';
import {
  blockersOf,
  cardInlineFields,
  columnSwaps,
  dependentsOf,
  matchesFilters,
  timelineGroups,
  toUpsert,
  visibleColumnCount,
} from './work-model';

const task = (id: string, patch: Partial<TaskDetail> = {}): TaskDetail => ({
  id,
  title: id,
  description: null,
  start_date: null,
  end_date: null,
  completed: null,
  priority: 1,
  dependencies: [],
  projects: [],
  tags: [],
  files: [],
  calendars: [],
  contacts: [],
  ...patch,
});

describe('work model', () => {
  it('filters tasks', () => {
    const filters = { projects: ['P'], tags: [], priorities: [], showDone: false };
    expect(matchesFilters(task('a', { projects: ['P'] }), filters)).toBe(true);
    expect(matchesFilters(task('b'), filters)).toBe(false);
    expect(matchesFilters(task('c', { projects: ['P'], completed: '2026-01-01' }), filters)).toBe(
      false,
    );
  });

  it('finds blockers and dependents', () => {
    const a = task('a');
    const b = task('b', { dependencies: ['a'] });
    const c = task('c', { dependencies: ['b'] });
    const byId = new Map([a, b, c].map((item) => [item.id, item]));
    expect(blockersOf(c, byId).map((item) => item.id)).toEqual(['b']);
    expect([...dependentsOf('a', [a, b, c])].sort()).toEqual(['b', 'c']);
  });

  it('groups the timeline', () => {
    const groups = timelineGroups(
      [
        task('x', { end_date: '2026-10-10T00:00:00' }),
        task('y', { end_date: '2026-10-14T00:00:00' }),
      ],
      new Date(2026, 9, 14),
    );
    expect(groups.map((group) => [group.label, group.tone])).toEqual([
      ['4 day(s) overdue', 'overdue'],
      ['Today', 'today'],
    ]);
  });

  it('keeps relations on full replacement', () => {
    expect(toUpsert(task('a', { files: ['/f'] }), { title: 'New' })).toMatchObject({
      title: 'New',
      files: ['/f'],
    });
  });

  it('plans column swaps', () => {
    expect(columnSwaps(0, 2)).toEqual(['right', 'right']);
    expect(columnSwaps(3, 1)).toEqual(['left', 'left']);
  });

  it('reads the card inline fields', () => {
    expect([...cardInlineFields(undefined)]).toEqual(['projects', 'tags', 'people']);
    expect([...cardInlineFields('files')]).toEqual(['projects', 'tags', 'people']);
    expect([...cardInlineFields(['files', 'bogus', 'tags'])]).toEqual(['tags', 'files']);
    expect([...cardInlineFields([])]).toEqual([]);
  });

  it('limits the visible columns', () => {
    expect(visibleColumnCount(6, 3)).toBe(3);
    expect(visibleColumnCount(4, 9)).toBe(4);
    expect(visibleColumnCount(0, 9)).toBe(1);
    expect(visibleColumnCount(99, 20)).toBe(12);
    expect(visibleColumnCount(Number.NaN, 9)).toBe(6);
    expect(visibleColumnCount(6, 0)).toBe(1);
  });
});

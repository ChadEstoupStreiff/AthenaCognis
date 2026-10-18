import type { TaskSummary } from '@domain/contracts';
import { dueTasks, greeting, topSegments } from './home-model';

const task = (id: string, end: string | null, priority = 1): TaskSummary => ({
  id,
  title: id,
  description: null,
  start_date: null,
  end_date: end,
  completed: null,
  priority,
  dependencies: [],
});

describe('home model', () => {
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 15))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening');
  });

  it('keeps tasks due within two weeks, most urgent first', () => {
    const today = new Date(2026, 9, 14);
    const due = dueTasks(
      [
        task('later', '2026-12-01T00:00:00'),
        task('soon', '2026-10-16T00:00:00'),
        task('late', '2026-10-01T00:00:00'),
        task('none', null),
      ],
      today,
    );
    expect(due.map((entry) => entry.task.id)).toEqual(['late', 'soon']);
    expect(due[0]?.days).toBe(-13);
  });

  it('groups small segments as Other', () => {
    const counts = Array.from({ length: 10 }, (_, index) => ({
      name: `n${String(index)}`,
      count: index + 1,
    }));
    const segments = topSegments(counts, () => '#000000');
    expect(segments).toHaveLength(9);
    expect(segments.at(-1)).toEqual({ label: 'Other', value: 3, color: '#94a3b8' });
  });
});

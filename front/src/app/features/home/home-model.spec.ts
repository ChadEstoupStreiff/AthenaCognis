import type { DashboardMetrics, MailCounters, TaskSummary } from '@domain/contracts';
import {
  dueTasks,
  greeting,
  kpiGroups,
  mailCategorySegments,
  percent,
  topSegments,
} from './home-model';

const MAIL: MailCounters = {
  accounts: 1,
  received: 40,
  unread: 10,
  needsReply: 3,
  flagged: 2,
  sent: 5,
  drafts: 1,
  outbox: 1,
  outboxFailed: 1,
  previews: 20,
  vipSenders: 2,
  blockedSenders: 1,
};

const metrics = (overrides: Partial<DashboardMetrics> = {}): DashboardMetrics => ({
  counters: {
    files: 10,
    projects: 2,
    tags: 3,
    summaries: 5,
    calendarEvents: 4,
    hours: 6.25,
    links: 1,
    contacts: 2,
    tasks: 4,
    boards: 1,
    validatedTasks: 1,
    filesWithoutTag: 2,
    filesWithoutProject: 3,
  },
  filesPerProject: [],
  filesPerTag: [],
  fileTypes: [],
  disk: { total: 0, available: 0, other: 0, back: 0, ollama: 0, mysql: 0, files: 0 },
  features: null,
  mail: null,
  mailCategories: [],
  hoursPerProject: [],
  ...overrides,
});

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

  it('formats shares as rounded percentages, 0% of nothing', () => {
    expect(percent(1, 3)).toBe('33%');
    expect(percent(5, 0)).toBe('0%');
  });

  it('hides the mail group without an account and on older backends', () => {
    expect(kpiGroups(metrics()).map((group) => group.title)).toEqual([
      'Library',
      'Work & time',
      'AI & automation',
    ]);
    const noAccount = metrics({ mail: { ...MAIL, accounts: 0 } });
    expect(kpiGroups(noAccount).some((group) => group.title === 'Mail')).toBe(false);
  });

  it('builds mail tiles with failed outbox and preview coverage', () => {
    const mail = kpiGroups(metrics({ mail: MAIL })).find((group) => group.title === 'Mail');
    const byLabel = new Map(mail?.tiles.map((entry) => [entry.label, entry]));
    expect(byLabel.get('Unread')?.hint).toBe('25% of received');
    expect(byLabel.get('Outbox')?.hint).toBe('Waiting to send · 1 failed');
    expect(byLabel.get('Mail previews')?.hint).toBe('50% of received');
  });

  it('labels and colors mail categories', () => {
    const segments = mailCategorySegments([
      { name: 'newsletter', count: 4 },
      { name: 'person', count: 9 },
    ]);
    expect(segments.map((segment) => segment.label)).toEqual(['People', 'Newsletters']);
    expect(segments[0]?.color).toBe('#2563eb');
  });
});

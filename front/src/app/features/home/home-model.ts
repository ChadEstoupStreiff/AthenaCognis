import type {
  DashboardMetrics,
  FeatureCounters,
  MailCounters,
  NamedCount,
  TaskSummary,
} from '@domain/contracts';
import { TASK_PRIORITIES } from '@domain/contracts';
import { colorForName } from '@domain/color';
import { daysBetween, parseLocalDate } from '@domain/time';

/** Segment of a meter bar. */
export interface MeterSegment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

/** KPI tile. */
export interface KpiTile {
  readonly label: string;
  readonly value: string;
  readonly icon: string;
  readonly hint: string;
}

/** Titled group of KPI tiles. */
export interface KpiGroup {
  readonly title: string;
  readonly tiles: readonly KpiTile[];
}

/** Task due soon, with its urgency. */
export interface DueTask {
  readonly task: TaskSummary;
  readonly days: number;
  readonly icon: string;
  readonly color: string;
}

const MORNING_END = 12;
const AFTERNOON_END = 18;
const MAX_SEGMENTS = 8;
const DISK_COLORS = {
  files: '#7700a7',
  mysql: '#2563eb',
  ollama: '#0891b2',
  back: '#ca8a04',
  other: '#94a3b8',
} as const;
const DUE_HORIZON_DAYS = 14;
const ISO_DATE_LENGTH = 10;
const PERCENT = 100;
const MAIL_CATEGORY_COLORS: Readonly<Record<string, string>> = {
  person: '#2563eb',
  newsletter: '#ca8a04',
  notification: '#94a3b8',
};
const MAIL_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  person: 'People',
  newsletter: 'Newsletters',
  notification: 'Notifications',
};

/**
 * Greeting for the time of day.
 *
 * @param now - Current time.
 * @returns Greeting.
 */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < MORNING_END) {
    return 'Good morning';
  }
  return hour < AFTERNOON_END ? 'Good afternoon' : 'Good evening';
}

/**
 * Top N counts as meter segments (rest grouped as "Other").
 *
 * @param counts - Named counts.
 * @param colorOf - Color per name.
 * @returns Segments.
 */
export function topSegments(
  counts: readonly NamedCount[],
  colorOf: (name: string) => string,
): MeterSegment[] {
  const sorted = [...counts].sort((left, right) => right.count - left.count);
  const head = sorted.slice(0, MAX_SEGMENTS).map((entry) => ({
    label: entry.name || '(none)',
    value: entry.count,
    color: colorOf(entry.name),
  }));
  const rest = sorted.slice(MAX_SEGMENTS).reduce((sum, entry) => sum + entry.count, 0);
  return rest > 0 ? [...head, { label: 'Other', value: rest, color: DISK_COLORS.other }] : head;
}

/**
 * Disk usage of the app (other disk content excluded).
 *
 * @param metrics - Dashboard metrics.
 * @returns Segments in bytes.
 */
export function diskSegments(metrics: DashboardMetrics): MeterSegment[] {
  const { disk } = metrics;
  return [
    { label: 'Files', value: disk.files, color: DISK_COLORS.files },
    { label: 'Database', value: disk.mysql, color: DISK_COLORS.mysql },
    { label: 'Ollama models', value: disk.ollama, color: DISK_COLORS.ollama },
    { label: 'AI caches', value: disk.back, color: DISK_COLORS.back },
  ];
}

/**
 * Format a count.
 *
 * @param value - Count.
 * @returns Label.
 */
function count(value: number): string {
  return String(value);
}

/**
 * Format a share as a rounded percentage.
 *
 * @param part - Part.
 * @param whole - Whole (0 gives 0%).
 * @returns Label.
 */
export function percent(part: number, whole: number): string {
  return `${String(whole > 0 ? Math.round((part / whole) * PERCENT) : 0)}%`;
}

/**
 * Build one KPI tile.
 *
 * @param label - Label.
 * @param value - Value.
 * @param icon - PrimeIcons class.
 * @param hint - Secondary line.
 * @returns Tile.
 */
function tile(label: string, value: number | string, icon: string, hint: string): KpiTile {
  return { label, value: String(value), icon: `pi ${icon}`, hint };
}

/**
 * Library tiles: files, organisation, links, notes.
 *
 * @param metrics - Dashboard metrics.
 * @returns Tiles.
 */
function libraryTiles(metrics: DashboardMetrics): KpiTile[] {
  const { counters, features } = metrics;
  const tiles = [
    tile(
      'Files',
      counters.files,
      'pi-file',
      `${count(counters.filesWithoutProject)} without project`,
    ),
    tile('Projects', counters.projects, 'pi-briefcase', 'With at least one file'),
    tile('Tags', counters.tags, 'pi-tags', `${count(counters.filesWithoutTag)} files untagged`),
    tile('Links', counters.links, 'pi-link', 'File relations'),
  ];
  if (features === null) {
    return tiles;
  }
  return [
    ...tiles,
    tile('Notes', features.notes, 'pi-pen-to-square', 'Files with a note'),
    tile('Pinned', features.pinned, 'pi-thumbtack', 'Pinned files'),
  ];
}

/**
 * Work tiles: time, tasks, boards, people.
 *
 * @param metrics - Dashboard metrics.
 * @returns Tiles.
 */
function workTiles(metrics: DashboardMetrics): KpiTile[] {
  const { counters, features } = metrics;
  const open = counters.tasks - counters.validatedTasks;
  const dependencies = features ? ` · ${count(features.taskDependencies)} dependencies` : '';
  const columns = features ? ` · ${count(features.boardColumns)} columns` : '';
  return [
    tile('Hours', counters.hours.toFixed(1), 'pi-clock', 'Total time logged'),
    tile('Time entries', counters.calendarEvents, 'pi-calendar', 'Calendar records'),
    tile(
      'Tasks',
      counters.tasks,
      'pi-check-square',
      `${count(open)} open · ${count(counters.validatedTasks)} done${dependencies}`,
    ),
    tile(
      'Completion',
      percent(counters.validatedTasks, counters.tasks),
      'pi-chart-pie',
      'Tasks done',
    ),
    tile('Boards', counters.boards, 'pi-th-large', `Kanban boards${columns}`),
    tile('People', counters.contacts, 'pi-users', 'Contacts'),
  ];
}

/**
 * Mail tiles (none without a mail account).
 *
 * @param mail - Mail counters.
 * @returns Tiles.
 */
function mailTiles(mail: MailCounters | null): KpiTile[] {
  if (mail === null || mail.accounts === 0) {
    return [];
  }
  const failed = mail.outboxFailed > 0 ? ` · ${count(mail.outboxFailed)} failed` : '';
  return [
    tile('Received', mail.received, 'pi-inbox', `${count(mail.accounts)} account(s)`),
    tile(
      'Unread',
      mail.unread,
      'pi-envelope',
      `${percent(mail.unread, mail.received)} of received`,
    ),
    tile('Needs reply', mail.needsReply, 'pi-reply', `${count(mail.flagged)} flagged`),
    tile('Sent', mail.sent, 'pi-send', `${count(mail.drafts)} drafts`),
    tile('Outbox', mail.outbox, 'pi-clock', `Waiting to send${failed}`),
    tile(
      'Mail previews',
      mail.previews,
      'pi-sparkles',
      `${percent(mail.previews, mail.received)} of received`,
    ),
    tile('VIP senders', mail.vipSenders, 'pi-star', `${count(mail.blockedSenders)} blocked`),
  ];
}

/**
 * Assistant tiles: chat, research papers, activity generation.
 *
 * @param features - Feature counters.
 * @returns Tiles.
 */
function assistantTiles(features: FeatureCounters): KpiTile[] {
  return [
    tile(
      'Chats',
      features.chatSessions,
      'pi-comments',
      `${count(features.chatMessages)} questions asked`,
    ),
    tile(
      'Papers',
      features.papers,
      'pi-book',
      `${count(features.papersWithMetadata)} with metadata · ${count(features.papersWithReferences)} with references`,
    ),
    tile(
      'Activity days',
      features.activityDays,
      'pi-bolt',
      `${count(features.activityEntries)} entries · ${features.activityHours.toFixed(1)}h generated`,
    ),
  ];
}

/**
 * AI and automation tiles: summaries, extraction, search, chat, research, activity.
 *
 * @param metrics - Dashboard metrics.
 * @returns Tiles.
 */
function aiTiles(metrics: DashboardMetrics): KpiTile[] {
  const { counters, features } = metrics;
  const summaries = tile(
    'Summaries',
    counters.summaries,
    'pi-sparkles',
    `${percent(counters.summaries, counters.files)} of files`,
  );
  if (features === null) {
    return [summaries];
  }
  return [
    summaries,
    tile('OCR', features.ocr, 'pi-eye', 'Files with extracted text'),
    tile('Transcriptions', features.transcriptions, 'pi-microphone', 'Audio and video transcribed'),
    tile(
      'Indexed',
      features.embeddings,
      'pi-search',
      `${percent(features.embeddings, counters.files)} of files searchable`,
    ),
    tile('Document trees', features.documentTrees, 'pi-sitemap', 'Section outlines'),
    ...assistantTiles(features),
  ];
}

/**
 * KPI tile groups of the Insights tab (empty groups dropped).
 *
 * @param metrics - Dashboard metrics.
 * @returns Groups.
 */
export function kpiGroups(metrics: DashboardMetrics): KpiGroup[] {
  const groups = [
    { title: 'Library', tiles: libraryTiles(metrics) },
    { title: 'Work & time', tiles: workTiles(metrics) },
    { title: 'Mail', tiles: mailTiles(metrics.mail) },
    { title: 'AI & automation', tiles: aiTiles(metrics) },
  ];
  return groups.filter((group) => group.tiles.length > 0);
}

/**
 * Open tasks due within two weeks (or overdue), most urgent first.
 *
 * @param tasks - Open tasks with a due date.
 * @param today - Reference day.
 * @returns Due tasks.
 */
export function dueTasks(tasks: readonly TaskSummary[], today: Date): DueTask[] {
  return tasks
    .flatMap((task) => {
      const due = parseLocalDate((task.end_date ?? '').slice(0, ISO_DATE_LENGTH));
      if (due === null) {
        return [];
      }
      const priority =
        TASK_PRIORITIES.find((candidate) => candidate.value === task.priority) ??
        TASK_PRIORITIES[1];
      return [{ task, days: daysBetween(today, due), icon: priority.icon, color: priority.color }];
    })
    .filter((entry) => entry.days <= DUE_HORIZON_DAYS)
    .sort((left, right) => left.days - right.days || right.task.priority - left.task.priority);
}

/**
 * Received mail per category as meter segments.
 *
 * @param counts - Messages per category.
 * @returns Segments.
 */
export function mailCategorySegments(counts: readonly NamedCount[]): MeterSegment[] {
  return topSegments(counts, (name) => MAIL_CATEGORY_COLORS[name] ?? colorForName(name)).map(
    (segment) => ({ ...segment, label: MAIL_CATEGORY_LABELS[segment.label] ?? segment.label }),
  );
}

/** Color of a file-type segment. */
export const typeColor = colorForName;

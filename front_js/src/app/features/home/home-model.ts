import type { DashboardMetrics, NamedCount, TaskSummary } from '@domain/contracts';
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
 * KPI tiles of the Insights tab.
 *
 * @param metrics - Dashboard metrics.
 * @returns Tiles.
 */
export function kpiTiles(metrics: DashboardMetrics): KpiTile[] {
  const counters = metrics.counters;
  return [
    tile(
      'Files',
      counters.files,
      'pi-file',
      `${String(counters.filesWithoutProject)} without project`,
    ),
    tile('Projects', counters.projects, 'pi-briefcase', 'With at least one file'),
    tile('Tags', counters.tags, 'pi-tags', `${String(counters.filesWithoutTag)} files untagged`),
    tile('Summaries', counters.summaries, 'pi-sparkles', 'AI summaries generated'),
    tile('Events', counters.calendarEvents, 'pi-calendar', 'Time entries'),
    tile('Hours', counters.hours.toFixed(1), 'pi-clock', 'Total time logged'),
    tile('Links', counters.links, 'pi-link', 'File relations'),
    tile('People', counters.contacts, 'pi-users', 'Contacts'),
    tile('Tasks', counters.tasks, 'pi-check-square', `${String(counters.validatedTasks)} done`),
    tile('Boards', counters.boards, 'pi-th-large', 'Kanban boards'),
  ];
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

/** Color of a file-type segment. */
export const typeColor = colorForName;

import type { GeneratedRecord, GenerationRun } from '@domain/contracts';

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * Two-digit clock part.
 *
 * @param value - Whole number.
 * @returns Zero-padded value.
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Clock range of a generated time entry.
 *
 * @param record - Time entry.
 * @returns "HH:MM – HH:MM", or the length alone without start.
 */
export function recordRange(record: GeneratedRecord): string {
  if (record.start === null) {
    return `${String(record.hours)} h`;
  }
  const [hours = 0, minutes = 0] = record.start.split(':').map(Number);
  const end = hours * MINUTES_PER_HOUR + minutes + Math.round(record.hours * MINUTES_PER_HOUR);
  const endHours = Math.floor(end / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  return `${record.start} – ${pad(endHours)}:${pad(end % MINUTES_PER_HOUR)}`;
}

/**
 * Tell whether a generation is queued or running.
 *
 * @param run - Latest run, null when never run.
 * @returns True while pending or in progress.
 */
export function isGenerating(run: GenerationRun | null): boolean {
  return run?.state === 'PENDING' || run?.state === 'IN_PROGRESS';
}

/**
 * Note body without its generated title line.
 *
 * @param content - Note markdown.
 * @returns Markdown after the first "# " line.
 */
export function noteBody(content: string): string {
  return content.replace(/^# .*\n+/, '');
}

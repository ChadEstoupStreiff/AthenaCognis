import type { ScanProgress } from '@domain/contracts';

/** Value of a finished scan. */
const FULL_PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const RATE_DECIMALS = 2;
const UNKNOWN_DURATION = '?';
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * Percent of a scan done.
 *
 * @param progress - Scan progress.
 * @returns 0..100, 0 while the total is unknown.
 */
export function scanPercent(progress: ScanProgress): number {
  if (progress.total <= 0) {
    return 0;
  }
  return Math.min(FULL_PERCENT, Math.round((progress.done / progress.total) * FULL_PERCENT));
}

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
 * Format a duration like tqdm.
 *
 * @param seconds - Duration in seconds.
 * @returns "mm:ss", or "h:mm:ss" from one hour.
 */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = `${pad(minutes)}:${pad(whole % SECONDS_PER_MINUTE)}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}

/**
 * Seconds left at the current pace.
 *
 * @param progress - Scan progress.
 * @returns Seconds, null before the first step.
 */
function remaining(progress: ScanProgress): number | null {
  if (progress.done <= 0) {
    return null;
  }
  return (progress.elapsed / progress.done) * Math.max(0, progress.total - progress.done);
}

/**
 * Timing part of the line: elapsed, remaining and pace.
 *
 * @param progress - Scan progress.
 * @returns "[elapsed<remaining, rate unit/s]".
 */
function timing(progress: ScanProgress): string {
  const left = remaining(progress);
  const eta = left === null ? UNKNOWN_DURATION : clock(left);
  const rate =
    progress.elapsed > 0
      ? (progress.done / progress.elapsed).toFixed(RATE_DECIMALS)
      : UNKNOWN_DURATION;
  return `[${clock(progress.elapsed)}<${eta}, ${rate} ${progress.unit}/s]`;
}

/**
 * Describe a scan like a tqdm bar caption.
 *
 * @param progress - Scan progress.
 * @returns e.g. "Scanning 40% 2/5 folders [00:04<00:06, 0.50 folders/s] · 1,234 files".
 */
export function progressLine(progress: ScanProgress): string {
  const head = [progress.desc, `${scanPercent(progress)}%`].filter(Boolean).join(' ');
  const count = `${progress.done}/${progress.total} ${progress.unit}`.trim();
  const items = progress.item_unit
    ? ` · ${COUNT_FORMAT.format(progress.items)} ${progress.item_unit}`
    : '';
  return `${head} ${count} ${timing(progress)}${items}`;
}

import type { ScanProgress } from '@domain/contracts';

/** Value of a finished scan. */
const FULL_PERCENT = 100;

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

/** Storage key of the data source count seen on the last visit. */
const SOURCE_COUNT_KEY = 'ac.activity.source-count';

/** Placeholder count on a first visit, before any count is stored. */
const DEFAULT_SOURCE_COUNT = 4;

/**
 * Data source count seen on the last visit, or the default when missing or unreadable.
 *
 * @returns Number of source tiles to reserve while sources load.
 */
export function readSourceCount(): number {
  try {
    const stored = localStorage.getItem(SOURCE_COUNT_KEY);
    const count = Number(stored);
    if (stored !== null && Number.isInteger(count) && count >= 0) {
      return count;
    }
  } catch {
    // Storage unavailable: use the default count.
  }
  return DEFAULT_SOURCE_COUNT;
}

/**
 * Remember the data source count for the next visit's placeholders.
 *
 * @param count - Number of data sources on the page.
 */
export function saveSourceCount(count: number): void {
  try {
    localStorage.setItem(SOURCE_COUNT_KEY, String(count));
  } catch {
    // Storage unavailable (private mode): next visit uses the default count.
  }
}

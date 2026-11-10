import { Injectable } from '@angular/core';

/** Feature events counted between two telemetry reports (counts only, never what was searched). */
export type UsageEvent = 'research_searches' | 'research_discoveries' | 'research_imports';

/** Event counts. */
export type UsageCounts = Readonly<Record<UsageEvent, number>>;

const STORAGE_KEY = 'ac.telemetry.counters';
const EVENTS: readonly UsageEvent[] = [
  'research_searches',
  'research_discoveries',
  'research_imports',
];

/**
 * Counts with every event at zero.
 *
 * @returns Counts.
 */
export function emptyCounts(): UsageCounts {
  return { research_searches: 0, research_discoveries: 0, research_imports: 0 };
}

/**
 * Parse JSON text.
 *
 * @param text - Text or null.
 * @returns Value, or null when missing or invalid.
 */
function parseJson(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Parse stored counts, dropping unknown keys and invalid values.
 *
 * @param text - Stored JSON or null.
 * @returns Counts.
 */
export function parseCounts(text: string | null): UsageCounts {
  const counts: Record<UsageEvent, number> = { ...emptyCounts() };
  const raw = parseJson(text);
  if (typeof raw !== 'object' || raw === null) {
    return counts;
  }
  const source = raw as Record<string, unknown>;
  EVENTS.forEach((event) => {
    const value = source[event];
    counts[event] = typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
  });
  return counts;
}

/**
 * Counts left after a report (events counted while it was being sent are kept).
 *
 * @param current - Counts now.
 * @param sent - Counts reported.
 * @returns Remaining counts.
 */
export function subtractCounts(current: UsageCounts, sent: UsageCounts): UsageCounts {
  const left: Record<UsageEvent, number> = { ...emptyCounts() };
  EVENTS.forEach((event) => {
    left[event] = Math.max(0, current[event] - sent[event]);
  });
  return left;
}

/** Per-browser event counters (stored locally, reset after each report). */
@Injectable({ providedIn: 'root' })
export class UsageCounters {
  /**
   * Current counts.
   *
   * @returns Counts (zero when storage is unavailable).
   */
  read(): UsageCounts {
    try {
      return parseCounts(localStorage.getItem(STORAGE_KEY));
    } catch {
      return emptyCounts();
    }
  }

  /**
   * Count one event.
   *
   * @param event - Event.
   */
  increment(event: UsageEvent): void {
    const counts = this.read();
    this.write({ ...counts, [event]: counts[event] + 1 });
  }

  /**
   * Forget the reported counts.
   *
   * @param sent - Counts reported.
   */
  consume(sent: UsageCounts): void {
    this.write(subtractCounts(this.read(), sent));
  }

  /** Drop every count (consent withdrawn). */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable: nothing stored.
    }
  }

  /**
   * Store counts.
   *
   * @param counts - Counts.
   */
  private write(counts: UsageCounts): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
    } catch {
      // Storage unavailable (private window): events are not counted.
    }
  }
}

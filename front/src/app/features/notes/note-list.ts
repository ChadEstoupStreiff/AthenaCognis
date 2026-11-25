import { fileNameOf, parseSharedPath } from '@domain/files';

/** Notes split into pinned ones and the rest. */
export interface PinnedSplit {
  /** Pinned note paths, by name. */
  readonly pinned: readonly string[];
  /** Unpinned note paths, in input order. */
  readonly others: readonly string[];
}

/** Notes of one day. */
export interface NoteDay {
  /** Day `YYYY-MM-DD`. */
  readonly day: string;
  /** Note paths, newest name first. */
  readonly paths: readonly string[];
}

const TOKEN_SEPARATOR = /\s+/;

/**
 * Day of a note path.
 *
 * @param path - Note path.
 * @returns Day `YYYY-MM-DD`, or empty when the path is not dated.
 */
function dayOf(path: string): string {
  return parseSharedPath(path)?.date ?? '';
}

/**
 * Keep the notes whose name or day contains every word of the query (case-insensitive).
 *
 * @param paths - Note paths.
 * @param query - Search text.
 * @returns Matching paths, in input order.
 */
export function filterNotes(paths: readonly string[], query: string): string[] {
  const tokens = query.trim().toLowerCase().split(TOKEN_SEPARATOR).filter(Boolean);
  if (tokens.length === 0) {
    return [...paths];
  }
  return paths.filter((path) => {
    const haystack = `${dayOf(path)} ${fileNameOf(path)}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * Group notes by day, newest day first, newest name first inside a day.
 *
 * @param paths - Note paths.
 * @returns Days with their notes.
 */
export function groupNotesByDay(paths: readonly string[]): NoteDay[] {
  const byDay = new Map<string, string[]>();
  for (const path of paths) {
    const day = dayOf(path);
    byDay.set(day, [...(byDay.get(day) ?? []), path]);
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, dayPaths]) => ({
      day,
      paths: dayPaths.sort((left, right) => fileNameOf(right).localeCompare(fileNameOf(left))),
    }));
}

/**
 * Split notes into pinned ones (sorted by name) and the rest.
 *
 * @param paths - Note paths.
 * @param pinned - Pinned file paths.
 * @returns Pinned and unpinned notes.
 */
export function splitPinned(paths: readonly string[], pinned: ReadonlySet<string>): PinnedSplit {
  return {
    pinned: paths
      .filter((path) => pinned.has(path))
      .sort((left, right) => fileNameOf(left).localeCompare(fileNameOf(right))),
    others: paths.filter((path) => !pinned.has(path)),
  };
}

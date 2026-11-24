/** One line of a line diff. */
export interface DiffLine {
  readonly kind: 'same' | 'added' | 'removed';
  readonly text: string;
}

/** Above this many cells the LCS table is skipped (whole-text replace). */
const MAX_DIFF_CELLS = 4_000_000;

/**
 * Longest-common-subsequence lengths of two line lists (suffix table).
 *
 * @param before - Old lines.
 * @param after - New lines.
 * @returns Table where `[i][j]` is the LCS length of `before[i:]` and `after[j:]`.
 */
function lcsTable(before: readonly string[], after: readonly string[]): Uint32Array[] {
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const row = table[i];
    const below = table[i + 1];
    if (row === undefined || below === undefined) {
      continue;
    }
    for (let j = after.length - 1; j >= 0; j -= 1) {
      row[j] =
        before[i] === after[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

/** Positions in the old and new line lists. */
interface DiffCursor {
  i: number;
  j: number;
}

/**
 * Whether dropping the old line keeps a longer common subsequence than adding the new one.
 *
 * @param table - LCS suffix table.
 * @param cursor - Positions.
 * @returns `true` to emit a removal first.
 */
function prefersRemoval(table: readonly Uint32Array[], cursor: DiffCursor): boolean {
  return (table[cursor.i + 1]?.[cursor.j] ?? 0) >= (table[cursor.i]?.[cursor.j + 1] ?? 0);
}

/**
 * Emit the next diff line and advance the cursor (removals before additions).
 *
 * @param before - Old lines.
 * @param after - New lines.
 * @param table - LCS suffix table.
 * @param cursor - Positions in both lists (advanced in place).
 * @returns Diff line.
 */
function diffStep(
  before: readonly string[],
  after: readonly string[],
  table: readonly Uint32Array[],
  cursor: DiffCursor,
): DiffLine {
  const oldLine = before[cursor.i];
  const newLine = after[cursor.j];
  if (oldLine !== undefined && oldLine === newLine) {
    cursor.i += 1;
    cursor.j += 1;
    return { kind: 'same', text: oldLine };
  }
  if (oldLine !== undefined && (newLine === undefined || prefersRemoval(table, cursor))) {
    cursor.i += 1;
    return { kind: 'removed', text: oldLine };
  }
  cursor.j += 1;
  return { kind: 'added', text: newLine ?? '' };
}

/**
 * Line diff of two texts.
 *
 * @param oldText - Old text.
 * @param newText - New text.
 * @returns Lines in order, tagged same / removed / added.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split('\n');
  const after = newText.split('\n');
  if (before.length * after.length > MAX_DIFF_CELLS) {
    return [
      ...before.map((text) => ({ kind: 'removed' as const, text })),
      ...after.map((text) => ({ kind: 'added' as const, text })),
    ];
  }
  const table = lcsTable(before, after);
  const lines: DiffLine[] = [];
  const cursor: DiffCursor = { i: 0, j: 0 };
  while (cursor.i < before.length || cursor.j < after.length) {
    lines.push(diffStep(before, after, table, cursor));
  }
  return lines;
}

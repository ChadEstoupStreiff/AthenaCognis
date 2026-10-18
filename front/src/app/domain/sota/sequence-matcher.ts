/** Python's difflib autojunk applies to sequences at least this long. */
const AUTOJUNK_MIN_LENGTH = 200;
const POPULAR_DIVISOR = 100;

/** Matching block (`a[i:i+size] == b[j:j+size]`). */
interface Match {
  readonly i: number;
  readonly j: number;
  readonly size: number;
}

/**
 * Index positions of each element of `b`, without "popular" elements (difflib autojunk).
 *
 * @param b - Second sequence.
 * @returns Element → ascending positions.
 */
function chainB(b: readonly string[]): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  b.forEach((element, index) => {
    const positions = b2j.get(element) ?? [];
    positions.push(index);
    b2j.set(element, positions);
  });
  if (b.length >= AUTOJUNK_MIN_LENGTH) {
    const threshold = Math.floor(b.length / POPULAR_DIVISOR) + 1;
    for (const [element, positions] of [...b2j]) {
      if (positions.length > threshold) {
        b2j.delete(element);
      }
    }
  }
  return b2j;
}

/**
 * Longest matching block within `a[alo:ahi]` and `b[blo:bhi]` (port of `find_longest_match`).
 *
 * @param a - First sequence.
 * @param b - Second sequence.
 * @param b2j - Index of `b`.
 * @param bounds - `[alo, ahi, blo, bhi]`.
 * @returns Best match.
 */
function longestMatch(
  a: readonly string[],
  b: readonly string[],
  b2j: Map<string, number[]>,
  bounds: readonly [number, number, number, number],
): Match {
  const [alo, ahi, blo, bhi] = bounds;
  let best: Match = { i: alo, j: blo, size: 0 };
  let lengths = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    for (const j of b2j.get(a[i] ?? '') ?? []) {
      if (j < blo) {
        continue;
      }
      if (j >= bhi) {
        break;
      }
      const size = (lengths.get(j - 1) ?? 0) + 1;
      next.set(j, size);
      if (size > best.size) {
        best = { i: i - size + 1, j: j - size + 1, size };
      }
    }
    lengths = next;
  }
  return extendMatch(a, b, best, bounds);
}

/**
 * Grow a match over equal neighbors (elements removed as popular can still extend it).
 *
 * @param a - First sequence.
 * @param b - Second sequence.
 * @param match - Match.
 * @param bounds - `[alo, ahi, blo, bhi]`.
 * @returns Extended match.
 */
function extendMatch(
  a: readonly string[],
  b: readonly string[],
  match: Match,
  bounds: readonly [number, number, number, number],
): Match {
  const [alo, ahi, blo, bhi] = bounds;
  let { i, j, size } = match;
  while (i > alo && j > blo && a[i - 1] === b[j - 1]) {
    i -= 1;
    j -= 1;
    size += 1;
  }
  while (i + size < ahi && j + size < bhi && a[i + size] === b[j + size]) {
    size += 1;
  }
  return { i, j, size };
}

/**
 * Total size of matching blocks (port of `get_matching_blocks`).
 *
 * @param a - First sequence.
 * @param b - Second sequence.
 * @returns Matched elements count.
 */
function matchedCount(a: readonly string[], b: readonly string[]): number {
  const b2j = chainB(b);
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  let total = 0;
  for (let bounds = queue.pop(); bounds !== undefined; bounds = queue.pop()) {
    const [alo, ahi, blo, bhi] = bounds;
    const { i, j, size } = longestMatch(a, b, b2j, bounds);
    if (size === 0) {
      continue;
    }
    total += size;
    if (alo < i && blo < j) {
      queue.push([alo, i, blo, j]);
    }
    if (i + size < ahi && j + size < bhi) {
      queue.push([i + size, ahi, j + size, bhi]);
    }
  }
  return total;
}

/**
 * Similarity of two strings, identical to Python's `difflib.SequenceMatcher(None, a, b).ratio()`.
 *
 * @param left - First string.
 * @param right - Second string.
 * @returns Ratio in [0, 1].
 */
export function sequenceRatio(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = a.length + b.length;
  return length === 0 ? 1 : (2 * matchedCount(a, b)) / length;
}

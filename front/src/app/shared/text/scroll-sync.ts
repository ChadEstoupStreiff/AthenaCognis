/** Matching scroll offsets in two panes. */
export interface ScrollAnchor {
  readonly source: number;
  readonly target: number;
}

/**
 * Pair matching block offsets of two panes (headings), framed by both ends.
 * Falls back to a proportional mapping when the panes disagree on the block count.
 *
 * @param sourceTops - Block offsets in the source pane.
 * @param targetTops - Block offsets in the target pane.
 * @param sourceMax - Maximum scroll offset of the source pane.
 * @param targetMax - Maximum scroll offset of the target pane.
 * @returns Anchors with strictly increasing sources.
 */
export function buildAnchors(
  sourceTops: readonly number[],
  targetTops: readonly number[],
  sourceMax: number,
  targetMax: number,
): ScrollAnchor[] {
  const middle =
    sourceTops.length === targetTops.length
      ? sourceTops.map((source, index) => ({ source, target: targetTops[index] ?? 0 }))
      : [];
  const anchors: ScrollAnchor[] = [];
  for (const anchor of [
    { source: 0, target: 0 },
    ...middle,
    { source: sourceMax, target: targetMax },
  ]) {
    const previous = anchors.at(-1);
    const isAfter =
      previous === undefined ||
      (anchor.source > previous.source && anchor.target >= previous.target);
    if (isAfter && anchor.source <= sourceMax && anchor.target <= targetMax) {
      anchors.push(anchor);
    }
  }
  return anchors;
}

/**
 * Map a source scroll offset to the target pane (piecewise linear between anchors).
 *
 * @param anchors - Anchors sorted by source.
 * @param position - Source offset.
 * @returns Target offset.
 */
export function mapScroll(anchors: readonly ScrollAnchor[], position: number): number {
  const nextIndex = anchors.findIndex((anchor) => anchor.source >= position);
  const next = anchors[nextIndex];
  const previous = anchors[nextIndex - 1];
  if (next === undefined) {
    return anchors.at(-1)?.target ?? 0;
  }
  if (previous === undefined) {
    return next.target;
  }
  const fraction = (position - previous.source) / (next.source - previous.source);
  return previous.target + fraction * (next.target - previous.target);
}

/**
 * Swap the panes of anchors (for scrolling the other way).
 *
 * @param anchors - Anchors.
 * @returns Inverted anchors.
 */
export function invertAnchors(anchors: readonly ScrollAnchor[]): ScrollAnchor[] {
  const inverted: ScrollAnchor[] = [];
  for (const anchor of anchors) {
    const previous = inverted.at(-1);
    if (previous === undefined || anchor.target > previous.source) {
      inverted.push({ source: anchor.target, target: anchor.source });
    }
  }
  return inverted;
}

/** Distance under which an eased scroll snaps to its target (px). */
const SNAP_DISTANCE = 0.5;

/**
 * Next offset of an eased scroll (exponential ease-out).
 *
 * @param current - Current offset.
 * @param target - Target offset.
 * @param factor - Fraction of the remaining distance covered per frame (0–1].
 * @returns Next offset (the target once close enough).
 */
export function easeStep(current: number, target: number, factor: number): number {
  const remaining = target - current;
  return Math.abs(remaining) <= SNAP_DISTANCE ? target : current + remaining * factor;
}

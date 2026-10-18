import type { SummaryRecord } from '../contracts/jobs';

const FENCE_LINE = /^\s*(```|~~~)[\w-]*\s*$/;
const LANGUAGE_LINE = /^\s*(markdown|md)\s*$/i;

/**
 * Count Markdown fence lines.
 *
 * @param lines - Text lines.
 * @returns Number of fence lines.
 */
function fenceCount(lines: readonly string[]): number {
  return lines.filter((line) => FENCE_LINE.test(line)).length;
}

/**
 * Drop the first line when it matches a pattern.
 *
 * @param lines - Text lines (mutated).
 * @param pattern - Line pattern.
 */
function dropFirst(lines: string[], pattern: RegExp): void {
  if (pattern.test(lines[0] ?? '')) {
    lines.shift();
  }
}

/**
 * Remove the code fences and stray `markdown` line LLMs wrap their answers in.
 *
 * @param text - Raw summary.
 * @returns Markdown ready to render.
 */
export function cleanSummaryText(text: string): string {
  const lines = text.trim().split('\n');
  dropFirst(lines, FENCE_LINE);
  dropFirst(lines, LANGUAGE_LINE);
  const unmatchedClosingFence = FENCE_LINE.test(lines.at(-1) ?? '') && fenceCount(lines) % 2 === 1;
  if (unmatchedClosingFence) {
    lines.pop();
  }
  return lines.join('\n').trim();
}

/**
 * Summary record with a cleaned text.
 *
 * @param record - Backend record or null.
 * @returns Cleaned record, or null.
 */
export function toSummaryRecord(record: SummaryRecord | null): SummaryRecord | null {
  return record === null ? null : { ...record, summary: cleanSummaryText(record.summary) };
}

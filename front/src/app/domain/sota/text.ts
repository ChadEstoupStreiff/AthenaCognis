import { sequenceRatio } from './sequence-matcher';

const TITLE_MATCH_THRESHOLD = 0.9;
const WORDS_PER_ALLOWED_TYPO = 10;
const YEAR_PATTERN = /\b(\d{4})\b/;
const NON_ASCII = /[\u0080-\uFFFF]/g;

/**
 * Collapse whitespace (Python `" ".join(text.split())`).
 *
 * @param text - Raw text.
 * @returns Single-spaced, trimmed text.
 */
export function collapse(text: string | null | undefined): string {
  return (text ?? '').split(/\s+/).filter(Boolean).join(' ');
}

/**
 * First 4-digit year of a text.
 *
 * @param text - Date-like text.
 * @returns Year, or empty.
 */
export function findYear(text: string): string {
  return YEAR_PATTERN.exec(text)?.[1] ?? '';
}

/**
 * Lowercase a title and strip accents and punctuation for comparison.
 *
 * @param title - Raw title.
 * @returns Normalized title.
 */
export function normalizeTitle(title: string): string {
  const ascii = title.normalize('NFKD').replace(NON_ASCII, '');
  return collapse(ascii.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
}

/**
 * Whether two titles designate the same paper (similar characters, almost no differing word).
 *
 * @param candidate - Title returned by a search engine.
 * @param expected - Title searched.
 * @returns Match.
 */
export function titlesMatch(candidate: string, expected: string): boolean {
  const left = normalizeTitle(candidate);
  const right = normalizeTitle(expected);
  if (left === '' || right === '') {
    return false;
  }
  const leftWords = new Set(left.split(' '));
  const rightWords = new Set(right.split(' '));
  const allowedTypos = Math.floor(
    Math.max(left.split(' ').length, right.split(' ').length) / WORDS_PER_ALLOWED_TYPO,
  );
  const differing =
    [...leftWords].filter((word) => !rightWords.has(word)).length +
    [...rightWords].filter((word) => !leftWords.has(word)).length;
  if (differing > 2 * allowedTypos) {
    return false;
  }
  return sequenceRatio(left, right) >= TITLE_MATCH_THRESHOLD;
}

import type { SearchHit } from './search';
import { normalizeTitle } from './text';

/** Filters applied to the shown search / discovery results. */
export interface ResultFilters {
  /** Minimum citation count (unknown counts fail it), null = any. */
  readonly minCitations: number | null;
  /** Text one author name must contain. */
  readonly author: string;
  /** Text the venue must contain. */
  readonly venue: string;
  /** Words the title or abstract must all contain. */
  readonly include: string;
  /** Words the title or abstract must not contain. */
  readonly exclude: string;
  readonly withPdfOnly: boolean;
  readonly withAbstractOnly: boolean;
  readonly hideInLibrary: boolean;
}

/** No filtering. */
export const NO_RESULT_FILTERS: ResultFilters = {
  minCitations: null,
  author: '',
  venue: '',
  include: '',
  exclude: '',
  withPdfOnly: false,
  withAbstractOnly: false,
  hideInLibrary: false,
};

/**
 * Normalized words of a filter text.
 *
 * @param text - Text.
 * @returns Words.
 */
function words(text: string): string[] {
  return normalizeTitle(text).split(' ').filter(Boolean);
}

/**
 * Whether a normalized text contains a phrase.
 *
 * @param haystack - Text.
 * @param needle - Phrase (empty matches).
 * @returns Match.
 */
function containsPhrase(haystack: string, needle: string): boolean {
  const phrase = words(needle).join(' ');
  return phrase === '' || normalizeTitle(haystack).includes(phrase);
}

/**
 * Whether one author of a `Family, Given | …` list matches every word typed (any order, prefixes allowed).
 *
 * @param authors - Authors.
 * @param query - Typed name.
 * @returns Match.
 */
function authorMatches(authors: string, query: string): boolean {
  const wanted = words(query);
  return (
    wanted.length === 0 ||
    authors.split('|').some((author) => {
      const parts = words(author);
      return wanted.every((word) => parts.some((part) => part.startsWith(word)));
    })
  );
}

/**
 * Number of active filters.
 *
 * @param filters - Filters.
 * @returns Count.
 */
export function activeFilterCount(filters: ResultFilters): number {
  return [
    filters.minCitations !== null && filters.minCitations > 0,
    filters.author.trim() !== '',
    filters.venue.trim() !== '',
    filters.include.trim() !== '',
    filters.exclude.trim() !== '',
    filters.withPdfOnly,
    filters.withAbstractOnly,
    filters.hideInLibrary,
  ].filter(Boolean).length;
}

/**
 * Whether one hit passes the filters.
 *
 * @param hit - Hit.
 * @param filters - Filters.
 * @param owned - Hit is already in the library.
 * @returns Kept.
 */
function passes(hit: SearchHit, filters: ResultFilters, owned: boolean): boolean {
  const text = ` ${normalizeTitle(`${hit.info.title} ${hit.abstract}`)} `;
  const checks = [
    filters.minCitations === null || (hit.citedBy ?? -1) >= filters.minCitations,
    authorMatches(hit.info.authors, filters.author),
    containsPhrase(hit.info.journal, filters.venue),
    words(filters.include).every((word) => text.includes(` ${word}`)),
    !words(filters.exclude).some((word) => text.includes(` ${word}`)),
    !filters.withPdfOnly || hit.pdfUrls.length > 0,
    !filters.withAbstractOnly || hit.abstract !== '',
    !filters.hideInLibrary || !owned,
  ];
  return checks.every(Boolean);
}

/**
 * Keep the hits passing the filters.
 *
 * @param hits - Hits.
 * @param filters - Filters.
 * @param owned - Keys of hits already in the library.
 * @returns Kept hits.
 */
export function applyResultFilters(
  hits: readonly SearchHit[],
  filters: ResultFilters,
  owned: ReadonlySet<string>,
): SearchHit[] {
  return hits.filter((hit) => passes(hit, filters, owned.has(hit.key)));
}

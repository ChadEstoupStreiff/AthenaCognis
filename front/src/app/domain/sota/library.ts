import {
  displayTitle,
  type Paper,
  paperFileName,
  paperStatus,
  paperUploadDate,
  type StatusFilter,
} from './paper';

/** Sort options. */
export type PaperSort = 'Newest first' | 'Oldest first' | 'Title A → Z' | 'Recently added';

/** Sort options in display order. */
export const PAPER_SORTS: readonly PaperSort[] = [
  'Newest first',
  'Oldest first',
  'Title A → Z',
  'Recently added',
];

const YEAR_DIGITS = /\d{4}/;

/**
 * Whether title, authors, journal or file name contain a query.
 *
 * @param paper - Paper.
 * @param query - Case-insensitive text.
 * @returns Match (always for an empty query).
 */
export function matchesQuery(paper: Paper, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return `${paper.info.title} ${paper.info.authors} ${paper.info.journal} ${paperFileName(paper)}`
    .toLowerCase()
    .includes(needle);
}

/**
 * Papers matching a status and a query.
 *
 * @param papers - Papers.
 * @param status - Status filter.
 * @param query - Text.
 * @returns Filtered papers.
 */
export function filterPapers(
  papers: readonly Paper[],
  status: StatusFilter,
  query: string,
): Paper[] {
  return papers.filter(
    (paper) => (status === 'All' || paperStatus(paper) === status) && matchesQuery(paper, query),
  );
}

/**
 * Numeric year for sorting.
 *
 * @param paper - Paper.
 * @returns Year, 0 when unknown.
 */
function yearOf(paper: Paper): number {
  return Number(YEAR_DIGITS.exec(paper.info.year)?.[0] ?? 0);
}

const COMPARATORS: Readonly<Record<PaperSort, (left: Paper, right: Paper) => number>> = {
  'Newest first': (left, right) => yearOf(right) - yearOf(left),
  'Oldest first': (left, right) => yearOf(left) - yearOf(right),
  'Title A → Z': (left, right) => {
    const a = displayTitle(left).toLowerCase();
    const b = displayTitle(right).toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  },
  'Recently added': (left, right) => paperUploadDate(right).localeCompare(paperUploadDate(left)),
};

/**
 * Sort papers (stable, like Python's `sorted`).
 *
 * @param papers - Papers.
 * @param sort - Sort option.
 * @returns Sorted copy.
 */
export function sortPapers(papers: readonly Paper[], sort: PaperSort): Paper[] {
  return [...papers].sort(COMPARATORS[sort]);
}

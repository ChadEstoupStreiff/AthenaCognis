/** Bibliographic metadata of a state-of-the-art paper (stored as JSON in `sota_info_<date>_<name>`). */
export interface PaperInfo {
  readonly title: string;
  readonly authors: string;
  readonly year: string;
  readonly journal: string;
  readonly url: string;
  readonly doi: string;
  readonly volume: string;
  readonly issue: string;
  readonly pages: string;
  readonly source: string;
  readonly validated: boolean;
}

/** Text fields of PaperInfo, in storage order. */
export const INFO_TEXT_FIELDS = [
  'title',
  'authors',
  'year',
  'journal',
  'url',
  'doi',
  'volume',
  'issue',
  'pages',
  'source',
] as const;

/** Text field name. */
export type InfoTextField = (typeof INFO_TEXT_FIELDS)[number];

/** Empty metadata. */
export const EMPTY_INFO: PaperInfo = {
  title: '',
  authors: '',
  year: '',
  journal: '',
  url: '',
  doi: '',
  volume: '',
  issue: '',
  pages: '',
  source: '',
  validated: false,
};

/** Paper of the library: a file tagged with the SOTA tag, with its metadata. */
export interface Paper {
  readonly path: string;
  readonly info: PaperInfo;
}

/** Review status. */
export type PaperStatus = 'Validated' | 'To review' | 'Missing info';

/** Status filter (`All` or a status). */
export type StatusFilter = 'All' | PaperStatus;

/** Status filters in display order. */
export const STATUS_FILTERS: readonly StatusFilter[] = [
  'All',
  'To review',
  'Validated',
  'Missing info',
];

const PATH_DATE_INDEX = 2;
const INFO_PREFIX = 'sota_info_';
const REFS_PREFIX = 'sota_refs_';
const MAX_DISPLAYED_AUTHORS = 3;

/**
 * Parse stored metadata, ignoring unknown keys (legacy table columns) and casting values like Python.
 *
 * @param raw - Stored object.
 * @returns Metadata.
 */
export function paperInfoFromDict(raw: unknown): PaperInfo {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return EMPTY_INFO;
  }
  const source = raw as Record<string, unknown>;
  const text = (key: InfoTextField): string => {
    const value = source[key];
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  };
  return {
    ...Object.fromEntries(INFO_TEXT_FIELDS.map((key) => [key, text(key)])),
    validated: Boolean(source['validated'] ?? false),
  } as PaperInfo;
}

/**
 * Metadata as stored by the Streamlit front (same key order).
 *
 * @param info - Metadata.
 * @returns JSON-ready object.
 */
export function paperInfoToDict(info: PaperInfo): Record<string, string | boolean> {
  return {
    ...Object.fromEntries(INFO_TEXT_FIELDS.map((key) => [key, info[key]])),
    validated: info.validated,
  };
}

/**
 * File name of a paper.
 *
 * @param paper - Paper.
 * @returns Name.
 */
export function paperFileName(paper: Pick<Paper, 'path'>): string {
  return paper.path.split('/').at(-1) ?? '';
}

/**
 * Upload date folder of a paper.
 *
 * @param paper - Paper.
 * @returns `YYYY-MM-DD`, or empty.
 */
export function paperUploadDate(paper: Pick<Paper, 'path'>): string {
  return paper.path.split('/')[PATH_DATE_INDEX] ?? '';
}

/**
 * Stockpile key of the metadata.
 *
 * @param paper - Paper.
 * @returns Key.
 */
export function infoKey(paper: Pick<Paper, 'path'>): string {
  return `${INFO_PREFIX}${paperUploadDate(paper)}_${paperFileName(paper)}`;
}

/**
 * Stockpile key of the citation record.
 *
 * @param paper - Paper.
 * @returns Key.
 */
export function refsKey(paper: Pick<Paper, 'path'>): string {
  return `${REFS_PREFIX}${paperUploadDate(paper)}_${paperFileName(paper)}`;
}

/**
 * Title, or file name without extension when missing.
 *
 * @param paper - Paper.
 * @returns Title.
 */
export function displayTitle(paper: Paper): string {
  const title = paper.info.title.trim();
  if (title !== '') {
    return title;
  }
  const name = paperFileName(paper);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Review status.
 *
 * @param paper - Paper.
 * @returns Status.
 */
export function paperStatus(paper: Paper): PaperStatus {
  if (paper.info.validated) {
    return 'Validated';
  }
  return paper.info.title.trim() === '' || paper.info.authors.trim() === ''
    ? 'Missing info'
    : 'To review';
}

/**
 * Family names of a `Family, Given | …` list, "et al." past three.
 *
 * @param authors - Authors.
 * @returns Short authors.
 */
export function shortAuthors(authors: string): string {
  const names = authors
    .split('|')
    .filter((author) => author.trim() !== '')
    .map((author) => (author.trim().split(',')[0] ?? '').trim());
  return names.length > MAX_DISPLAYED_AUTHORS
    ? `${names.slice(0, MAX_DISPLAYED_AUTHORS).join(', ')} et al.`
    : names.join(', ');
}

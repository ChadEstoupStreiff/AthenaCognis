import { parseBibtexRecords, type BibtexRecord } from './bibtex';
import { displayTitle, EMPTY_INFO, type Paper, type PaperInfo, paperInfoFromDict } from './paper';
import { titlesMatch } from './text';

/** Bibliographic record with an optional attached file name. */
export interface BibEntry {
  readonly info: PaperInfo;
  readonly attachment: string;
}

/** What the import does with one entry. */
export type ImportAction = 'update' | 'add' | 'skip';

/** Planned import of one entry. */
export interface ImportPlanItem {
  readonly entry: BibEntry;
  readonly existing: Paper | null;
  readonly pdfName: string;
  readonly action: ImportAction;
}

const AUTHOR_SEPARATOR = ' | ';
const BIBTEX_AUTHOR_SEPARATOR = ' and ';
/** Folder of attachments inside exported zips (Zotero re-attaches them). */
export const ATTACHMENTS_FOLDER = 'files';
const RIS_LINE = /^([A-Z][A-Z0-9]) {2}-(?: (.*))?$/;
const PDF_PATH = /[^:;{}]+\.pdf/i;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const PDF_EXTENSION = '.pdf';
const YEAR_LENGTH = 4;
/** Python's Unicode `\W`. */
const NON_WORD = /[^\p{L}\p{N}_]/gu;

/**
 * File name of a POSIX, Windows or `file://` path.
 *
 * @param path - Path or URL.
 * @returns Base name.
 */
export function fileBasename(path: string): string {
  const cleaned = path.trim().replace(/^file:\/\//, '');
  return cleaned.split(/[\\/]/).at(-1) ?? '';
}

/**
 * Normalize an author name to `Family, Given`.
 *
 * @param name - `Family, Given` or `Given Family`.
 * @returns Normalized name.
 */
export function toFamilyGiven(name: string): string {
  const collapsed = name.split(/\s+/).filter(Boolean).join(' ');
  const space = collapsed.lastIndexOf(' ');
  if (collapsed.includes(',') || space < 0) {
    return collapsed;
  }
  return `${collapsed.slice(space + 1)}, ${collapsed.slice(0, space)}`;
}

/**
 * Split a page range.
 *
 * @param pages - `12-34`, `12--34`, `12–34` or `e308`.
 * @returns Start and end (empty when single).
 */
export function splitPages(pages: string): [string, string] {
  const match = /-+|–/.exec(pages);
  if (match === null) {
    return [pages.trim(), ''];
  }
  return [pages.slice(0, match.index).trim(), pages.slice(match.index + match[0].length).trim()];
}

/**
 * First PDF of a BibTeX `file` field (Zotero / JabRef syntax).
 *
 * @param field - e.g. `Full Text PDF:files/12/x.pdf:application/pdf`.
 * @returns Base name, or empty.
 */
function firstPdf(field: string): string {
  const match = PDF_PATH.exec(field);
  return match === null ? '' : fileBasename(match[0]);
}

/**
 * Convert a BibTeX record into an entry.
 *
 * @param record - Parsed record.
 * @returns Entry.
 */
function bibtexToEntry(record: BibtexRecord): BibEntry {
  const field = (...names: string[]): string =>
    names.map((name) => record[name] ?? '').find(Boolean) ?? '';
  const authors = (record['author'] ?? '')
    .split(/\s+/)
    .join(' ')
    .split(BIBTEX_AUTHOR_SEPARATOR)
    .filter((author) => author.trim() !== '')
    .map(toFamilyGiven);
  const doi = field('doi');
  const info: PaperInfo = {
    ...EMPTY_INFO,
    title: (record['title'] ?? '').split(/\s+/).filter(Boolean).join(' '),
    authors: authors.join(AUTHOR_SEPARATOR),
    year: field('year') || field('date').slice(0, YEAR_LENGTH),
    journal: field('journal', 'journaltitle', 'booktitle'),
    url: field('url') || (doi ? `https://doi.org/${doi}` : ''),
    doi,
    volume: field('volume'),
    issue: field('number', 'issue'),
    pages: field('pages').replaceAll('--', '-'),
    source: 'bibtex',
  };
  return { info, attachment: firstPdf(field('file')) };
}

/**
 * Parse a BibTeX document.
 *
 * @param text - BibTeX content.
 * @returns Entries having a title.
 */
export function parseBibtex(text: string): BibEntry[] {
  return parseBibtexRecords(text)
    .map(bibtexToEntry)
    .filter((entry) => entry.info.title !== '');
}

/**
 * Unique citation key `FamilyYearWord`.
 *
 * @param info - Reference.
 * @param used - Keys already taken (updated).
 * @returns Key.
 */
function bibtexKey(info: PaperInfo, used: Set<string>): string {
  const family = (info.authors.split(',')[0] ?? '').split('|')[0]?.replace(NON_WORD, '') ?? '';
  const firstWord = (info.title.split(/\s+/).find(Boolean) ?? '').replace(NON_WORD, '');
  const base = `${family}${info.year}${firstWord}` || 'ref';
  let key = base;
  for (const suffix of ALPHABET) {
    if (!used.has(key)) {
      break;
    }
    key = `${base}${suffix}`;
  }
  used.add(key);
  return key;
}

/**
 * One `@article` entry.
 *
 * @param entry - Reference.
 * @param key - Citation key.
 * @returns BibTeX text.
 */
function bibtexEntry(entry: BibEntry, key: string): string {
  const { info } = entry;
  const values: [string, string][] = [
    [
      'author',
      info.authors
        .split('|')
        .map((author) => author.trim())
        .filter(Boolean)
        .join(BIBTEX_AUTHOR_SEPARATOR),
    ],
    ['title', info.title],
    ['journal', info.journal],
    ['year', info.year],
    ['volume', info.volume],
    ['number', info.issue],
    ['pages', info.pages.replaceAll('-', '--')],
    ['doi', info.doi],
    ['url', info.url],
    ['file', entry.attachment ? `${ATTACHMENTS_FOLDER}/${entry.attachment}` : ''],
  ];
  const lines = values
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `  ${name} = {${value}},`);
  return [`@article{${key},`, ...lines, '}'].join('\n');
}

/**
 * Format entries as BibTeX with unique keys.
 *
 * @param entries - References.
 * @returns BibTeX content.
 */
export function toBibtex(entries: readonly BibEntry[]): string {
  const used = new Set<string>();
  return entries.map((entry) => bibtexEntry(entry, bibtexKey(entry.info, used))).join('\n\n');
}

/**
 * BibTeX of stored metadata (Cite dialog).
 *
 * @param infos - References.
 * @returns BibTeX content.
 */
export function bibtexCitations(infos: readonly PaperInfo[]): string {
  return toBibtex(infos.map((info) => ({ info: paperInfoFromDict(info), attachment: '' })));
}

/**
 * Split a RIS document into records.
 *
 * @param text - RIS content.
 * @returns Tag → values, per record.
 */
function risRecords(text: string): Map<string, string[]>[] {
  const records: Map<string, string[]>[] = [];
  let current = new Map<string, string[]>();
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n|\r/)) {
    const match = RIS_LINE.exec(line.trimEnd());
    if (match === null) {
      continue;
    }
    const tag = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    if (tag === 'ER') {
      records.push(current);
      current = new Map();
    } else if (value !== '') {
      current.set(tag, [...(current.get(tag) ?? []), value]);
    }
  }
  return records;
}

/**
 * Convert a RIS record into an entry.
 *
 * @param record - Tag → values.
 * @returns Entry.
 */
function risToEntry(record: Map<string, string[]>): BibEntry {
  const first = (...tags: string[]): string =>
    tags.map((tag) => record.get(tag)?.[0]).find((value) => value !== undefined) ?? '';
  const doi = first('DO');
  const start = first('SP');
  const end = first('EP');
  const pdfs = (record.get('L1') ?? []).filter((value) =>
    value.toLowerCase().endsWith(PDF_EXTENSION),
  );
  const info: PaperInfo = {
    ...EMPTY_INFO,
    title: first('TI', 'T1'),
    authors: [...(record.get('AU') ?? []), ...(record.get('A1') ?? [])]
      .map(toFamilyGiven)
      .join(AUTHOR_SEPARATOR),
    year: first('PY', 'Y1', 'DA').slice(0, YEAR_LENGTH),
    journal: first('T2', 'JO', 'JF', 'JA'),
    url: first('UR') || (doi ? `https://doi.org/${doi}` : ''),
    doi,
    volume: first('VL'),
    issue: first('IS'),
    pages: start && end ? `${start}-${end}` : start,
    source: 'ris',
  };
  return { info, attachment: pdfs[0] === undefined ? '' : fileBasename(pdfs[0]) };
}

/**
 * Parse a RIS document (Zotero, Mendeley, EndNote).
 *
 * @param text - RIS content.
 * @returns Entries having a title.
 */
export function parseRis(text: string): BibEntry[] {
  return risRecords(text)
    .map(risToEntry)
    .filter((entry) => entry.info.title !== '');
}

/**
 * One RIS journal-article record.
 *
 * @param entry - Reference.
 * @returns RIS text.
 */
function risEntry(entry: BibEntry): string {
  const { info } = entry;
  const [start, end] = splitPages(info.pages);
  const tags: [string, string][] = [
    ['TY', 'JOUR'],
    ...info.authors
      .split('|')
      .map((author) => author.trim())
      .filter(Boolean)
      .map((author): [string, string] => ['AU', author]),
    ['TI', info.title],
    ['T2', info.journal],
    ['PY', info.year],
    ['VL', info.volume],
    ['IS', info.issue],
    ['SP', start],
    ['EP', end],
    ['DO', info.doi],
    ['UR', info.url],
  ];
  if (entry.attachment) {
    tags.push(['L1', `${ATTACHMENTS_FOLDER}/${entry.attachment}`]);
  }
  return [
    ...tags.filter(([, value]) => value !== '').map(([tag, value]) => `${tag}  - ${value}`),
    'ER  - ',
  ].join('\n');
}

/**
 * Format entries as RIS.
 *
 * @param entries - References.
 * @returns RIS content.
 */
export function toRis(entries: readonly BibEntry[]): string {
  return `${entries.map(risEntry).join('\n\n')}\n`;
}

/**
 * Library paper describing the same reference (DOI first, then title).
 *
 * @param info - Imported reference.
 * @param papers - Library.
 * @returns Paper, or null when new.
 */
export function findExisting(info: PaperInfo, papers: readonly Paper[]): Paper | null {
  const doi = info.doi.trim().toLowerCase();
  const byDoi =
    doi === '' ? undefined : papers.find((paper) => paper.info.doi.trim().toLowerCase() === doi);
  return byDoi ?? papers.find((paper) => titlesMatch(displayTitle(paper), info.title)) ?? null;
}

/**
 * Decide for each entry whether to update a paper, add its PDF, or skip it.
 *
 * @param entries - Imported references.
 * @param papers - Library.
 * @param pdfNames - Provided PDF names.
 * @returns One item per entry.
 */
export function planImport(
  entries: readonly BibEntry[],
  papers: readonly Paper[],
  pdfNames: ReadonlySet<string>,
): ImportPlanItem[] {
  return entries.map((entry) => {
    const existing = findExisting(entry.info, papers);
    const pdfName = pdfNames.has(entry.attachment) ? entry.attachment : '';
    return {
      entry,
      existing,
      pdfName,
      action: existing !== null ? 'update' : pdfName !== '' ? 'add' : 'skip',
    };
  });
}

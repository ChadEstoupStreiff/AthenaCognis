import { EMPTY_INFO, type PaperInfo } from './paper';
import { collapse, findYear } from './text';
import { ARXIV_NS, ATOM_NS, findAll, findFirst, parseXml, xmlText } from './xml';

const AUTHOR_SEPARATOR = ' | ';
const CROSSREF_DATE_KEYS = ['published-print', 'published-online', 'issued'] as const;

/** Untyped JSON object. */
type Json = Readonly<Record<string, unknown>>;

/**
 * Object view of unknown JSON.
 *
 * @param value - Value.
 * @returns Object (empty when not one).
 */
export function asJson(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

/**
 * Array view of unknown JSON.
 *
 * @param value - Value.
 * @returns Array (empty when not one).
 */
export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * String view of a JSON scalar.
 *
 * @param value - Value.
 * @returns String, empty for null/objects.
 */
export function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Authors of a CrossRef work.
 *
 * @param item - Work.
 * @returns `Family, Given | …`.
 */
function crossrefAuthors(item: Json): string {
  return asArray(item['author'])
    .map((raw) => {
      const author = asJson(raw);
      const parts = [collapse(asText(author['family'])), collapse(asText(author['given']))].filter(
        Boolean,
      );
      return parts.join(', ') || collapse(asText(author['name']));
    })
    .filter(Boolean)
    .join(AUTHOR_SEPARATOR);
}

/**
 * Publication year of a CrossRef work.
 *
 * @param item - Work.
 * @returns Year or empty.
 */
function crossrefYear(item: Json): string {
  for (const key of CROSSREF_DATE_KEYS) {
    const first = asArray(asArray(asJson(item[key])['date-parts'])[0])[0];
    if (first !== undefined && first !== null && first !== 0 && first !== '') {
      return asText(first);
    }
  }
  return '';
}

/**
 * Convert a CrossRef work into metadata.
 *
 * @param raw - Work (`message` of `/works/{doi}` or an item of `/works`).
 * @returns Metadata.
 */
export function crossrefToInfo(raw: unknown): PaperInfo {
  const item = asJson(raw);
  const doi = asText(item['DOI']);
  return {
    ...EMPTY_INFO,
    title: collapse(asText(asArray(item['title'])[0])),
    authors: crossrefAuthors(item),
    year: crossrefYear(item),
    journal: collapse(asText(asArray(item['container-title'])[0])),
    url: doi ? `https://doi.org/${doi}` : asText(item['URL']),
    doi,
    volume: asText(item['volume']),
    issue: asText(item['issue']),
    pages: asText(item['page']),
    source: 'crossref',
  };
}

/**
 * Convert a PubMed esummary record into metadata.
 *
 * @param pmid - PubMed id.
 * @param raw - Summary record.
 * @returns Metadata.
 */
export function pubmedToInfo(pmid: string, raw: unknown): PaperInfo {
  const summary = asJson(raw);
  const authors = asArray(summary['authors'])
    .map((author) => {
      const name = collapse(asText(asJson(author)['name']));
      const space = name.indexOf(' ');
      return space < 0 ? name : `${name.slice(0, space)}, ${name.slice(space + 1)}`;
    })
    .filter(Boolean);
  const doiEntry = asArray(summary['articleids'])
    .map(asJson)
    .find((entry) => entry['idtype'] === 'doi');
  return {
    ...EMPTY_INFO,
    title: collapse(asText(summary['title'])).replace(/\.+$/, ''),
    authors: authors.join(AUTHOR_SEPARATOR),
    year: findYear(asText(summary['pubdate'])),
    journal: collapse(asText(summary['fulljournalname']) || asText(summary['source'])),
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    doi: doiEntry === undefined ? '' : asText(doiEntry['value']),
    volume: asText(summary['volume']),
    issue: asText(summary['issue']),
    pages: asText(summary['pages']),
    source: 'pubmed',
  };
}

/**
 * Convert an arXiv Atom entry into metadata.
 *
 * @param entry - Atom entry.
 * @returns Metadata.
 */
export function arxivToInfo(entry: Element): PaperInfo {
  const authors = findAll(entry, ATOM_NS, [{ name: 'author' }])
    .map((author) => {
      const name = xmlText(findFirst(author, ATOM_NS, [{ name: 'name' }]));
      const space = name.lastIndexOf(' ');
      return space < 0 ? name : `${name.slice(space + 1)}, ${name.slice(0, space)}`;
    })
    .filter(Boolean);
  const text = (namespace: string, name: string): string =>
    xmlText(findFirst(entry, namespace, [{ name }]));
  return {
    ...EMPTY_INFO,
    title: text(ATOM_NS, 'title'),
    authors: authors.join(AUTHOR_SEPARATOR),
    year: findYear(text(ATOM_NS, 'published')),
    journal: text(ARXIV_NS, 'journal_ref') || 'arXiv',
    url: text(ATOM_NS, 'id'),
    doi: text(ARXIV_NS, 'doi'),
    source: 'arxiv',
  };
}

/**
 * Entries of an arXiv Atom feed.
 *
 * @param text - Atom XML.
 * @returns Metadata per entry.
 * @throws Error when the XML is invalid.
 */
export function parseArxivFeed(text: string): PaperInfo[] {
  return findAll(parseXml(text), ATOM_NS, [{ name: 'entry' }]).map(arxivToInfo);
}

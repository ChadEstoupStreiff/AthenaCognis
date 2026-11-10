import { EMPTY_INFO, type Paper, type PaperInfo } from './paper';
import { arxivToInfo, asArray, asJson, asText, crossrefToInfo } from './sources';
import { collapse, findYear, normalizeTitle, titlesMatch } from './text';
import { ATOM_NS, findAll, findFirst, parseXml, xmlText } from './xml';

/** Online catalogue searched by the Research search tab. */
export type SearchSource = 'openalex' | 'arxiv' | 'crossref';

/** Result ordering (applied to the shown results). */
export type SearchSort = 'relevance' | 'citations' | 'newest' | 'oldest' | 'title' | 'pdf';

/** Every source, in display order. */
export const SEARCH_SOURCES: readonly SearchSource[] = ['openalex', 'arxiv', 'crossref'];

/** Display label of each source. */
export const SOURCE_LABELS: Readonly<Record<SearchSource, string>> = {
  openalex: 'OpenAlex',
  arxiv: 'arXiv',
  crossref: 'CrossRef',
};

/** Sort options in display order. */
export const SEARCH_SORTS: readonly { readonly label: string; readonly value: SearchSort }[] = [
  { label: 'Relevance', value: 'relevance' },
  { label: 'Most cited', value: 'citations' },
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Title A→Z', value: 'title' },
  { label: 'PDF available first', value: 'pdf' },
];

/** What the user searches. */
export interface SearchQuery {
  readonly text: string;
  readonly sources: readonly SearchSource[];
  readonly yearFrom: number | null;
  readonly yearTo: number | null;
  /** Keep only results with a downloadable PDF. */
  readonly withPdfOnly: boolean;
  /** 1-based page. */
  readonly page: number;
}

/** One paper found online. */
export interface SearchHit {
  /** Deduplication key (DOI, else arXiv id, else normalized title). */
  readonly key: string;
  readonly info: PaperInfo;
  readonly abstract: string;
  /** Citation count, null when the source does not know. */
  readonly citedBy: number | null;
  /** Candidate PDF URLs, best first. */
  readonly pdfUrls: readonly string[];
  /** Open access according to the source. */
  readonly openAccess: boolean;
  readonly sources: readonly SearchSource[];
  /** Publication date (`YYYY-MM-DD`, or just the year). */
  readonly published: string;
  /** Why the paper is suggested (discovery only). */
  readonly reasons: readonly string[];
}

/** Identifier typed in the search box. */
export type PaperIdentifier =
  | { readonly kind: 'doi'; readonly value: string }
  | { readonly kind: 'arxiv'; readonly value: string };

const DOI_PATTERN = /\b(10\.\d{4,9}\/\S+)/i;
const ARXIV_ID_PATTERN = /^(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/i;
const ARXIV_ABS_PATTERN = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i;
const ARXIV_PDF_BASE = 'https://arxiv.org/pdf/';
const JATS_TAG = /<[^>]+>/g;
const ABSTRACT_PREFIX = /^abstract[\s.:]*/i;
const FILE_TITLE_WORDS = 8;
const FILE_NAME_MAX = 120;
const ISO_DATE_LENGTH = 10;
const TRAILING_DOI_PUNCTUATION = /[.,;)\]]+$/;

/**
 * Recognize a DOI or arXiv id typed in the search box.
 *
 * @param text - Query.
 * @returns Identifier, or null for free text.
 */
export function parseIdentifier(text: string): PaperIdentifier | null {
  const trimmed = text.trim();
  const arxiv = ARXIV_ID_PATTERN.exec(trimmed) ?? ARXIV_ABS_PATTERN.exec(trimmed);
  if (arxiv?.[1] !== undefined) {
    return { kind: 'arxiv', value: arxiv[1] };
  }
  const doi = DOI_PATTERN.exec(trimmed);
  if (doi?.[1] !== undefined && !trimmed.includes(' ')) {
    return { kind: 'doi', value: doi[1].replace(TRAILING_DOI_PUNCTUATION, '') };
  }
  return null;
}

/**
 * Rebuild an OpenAlex abstract from its inverted index.
 *
 * @param inverted - Word → positions.
 * @returns Abstract, empty when missing.
 */
export function rebuildAbstract(inverted: unknown): string {
  const words: string[] = [];
  Object.entries(asJson(inverted)).forEach(([word, positions]) => {
    asArray(positions).forEach((position) => {
      if (typeof position === 'number') {
        words[position] = word;
      }
    });
  });
  return collapse(words.filter(Boolean).join(' '));
}

/**
 * arXiv id of a DOI or URL.
 *
 * @param text - DOI (`10.48550/arXiv.x`) or arXiv URL.
 * @returns Id, or empty.
 */
function arxivIdOf(text: string): string {
  return (
    /arxiv\.(\d{4}\.\d{4,5})/i.exec(text)?.[1] ??
    ARXIV_ABS_PATTERN.exec(text)?.[1] ??
    ''
  ).toLowerCase();
}

/**
 * Deduplication key of a paper.
 *
 * @param info - Metadata.
 * @returns Key.
 */
export function hitKey(info: PaperInfo): string {
  const arxiv = arxivIdOf(info.doi) || arxivIdOf(info.url);
  if (arxiv !== '') {
    return `arxiv:${arxiv}`;
  }
  return info.doi === '' ? `title:${normalizeTitle(info.title)}` : `doi:${info.doi.toLowerCase()}`;
}

/**
 * Unique non-empty strings, order kept.
 *
 * @param values - Values.
 * @returns Unique values.
 */
function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

/**
 * `Family, Given | …` authors of OpenAlex authorships.
 *
 * @param authorships - Authorships.
 * @returns Authors.
 */
function openalexAuthors(authorships: unknown): string {
  return asArray(authorships)
    .map((authorship) => collapse(asText(asJson(asJson(authorship)['author'])['display_name'])))
    .filter(Boolean)
    .map((name) => {
      const space = name.lastIndexOf(' ');
      return space < 0 ? name : `${name.slice(space + 1)}, ${name.slice(0, space)}`;
    })
    .join(' | ');
}

/**
 * Metadata of an OpenAlex work.
 *
 * @param work - Work.
 * @returns Metadata.
 */
function openalexInfo(work: Readonly<Record<string, unknown>>): PaperInfo {
  const primary = asJson(work['primary_location']);
  const biblio = asJson(work['biblio']);
  const doi = asText(work['doi']).replace(/^https?:\/\/doi\.org\//i, '');
  const pages = [asText(biblio['first_page']), asText(biblio['last_page'])].filter(Boolean);
  return {
    ...EMPTY_INFO,
    title: collapse(asText(work['display_name'])),
    authors: openalexAuthors(work['authorships']),
    year: asText(work['publication_year']),
    journal: collapse(asText(asJson(primary['source'])['display_name'])),
    url:
      doi === ''
        ? asText(primary['landing_page_url']) || asText(work['id'])
        : `https://doi.org/${doi}`,
    doi,
    volume: asText(biblio['volume']),
    issue: asText(biblio['issue']),
    pages: pages.join('-'),
    source: 'openalex',
  };
}

/**
 * Candidate PDF URLs of an OpenAlex work (OA locations, arXiv, OA landing page).
 *
 * @param work - Work.
 * @param doi - DOI of the work.
 * @returns URLs, best first.
 */
function openalexPdfUrls(work: Readonly<Record<string, unknown>>, doi: string): string[] {
  const locations = [
    work['best_oa_location'],
    work['primary_location'],
    ...asArray(work['locations']),
  ];
  const arxiv = arxivIdOf(doi);
  return unique([
    ...locations.map((location) => asText(asJson(location)['pdf_url'])),
    arxiv === '' ? '' : `${ARXIV_PDF_BASE}${arxiv}`,
    asText(asJson(work['open_access'])['oa_url']),
  ]);
}

/**
 * Convert an OpenAlex work into a hit.
 *
 * @param raw - Work.
 * @returns Hit.
 */
export function openalexToHit(raw: unknown): SearchHit {
  const work = asJson(raw);
  const info = openalexInfo(work);
  return {
    key: hitKey(info),
    info,
    abstract: rebuildAbstract(work['abstract_inverted_index']),
    citedBy: typeof work['cited_by_count'] === 'number' ? work['cited_by_count'] : null,
    pdfUrls: openalexPdfUrls(work, info.doi),
    openAccess: asJson(work['open_access'])['is_oa'] === true,
    sources: ['openalex'],
    published: asText(work['publication_date']) || info.year,
    reasons: [],
  };
}

/**
 * Convert an arXiv Atom entry into a hit.
 *
 * @param entry - Atom entry.
 * @returns Hit.
 */
export function arxivEntryToHit(entry: Element): SearchHit {
  const info = arxivToInfo(entry);
  const pdfLink = findAll(entry, ATOM_NS, [{ name: 'link', attr: ['title', 'pdf'] }])[0];
  const id = arxivIdOf(info.url);
  const summary = findAll(entry, ATOM_NS, [{ name: 'summary' }])[0];
  return {
    key: hitKey(info),
    info: { ...info, url: id === '' ? info.url : `https://arxiv.org/abs/${id}` },
    abstract: collapse(summary?.textContent),
    citedBy: null,
    pdfUrls: unique([
      pdfLink?.getAttribute('href') ?? '',
      id === '' ? '' : `${ARXIV_PDF_BASE}${id}`,
    ]),
    openAccess: true,
    sources: ['arxiv'],
    published:
      xmlText(findFirst(entry, ATOM_NS, [{ name: 'published' }])).slice(0, ISO_DATE_LENGTH) ||
      info.year,
    reasons: [],
  };
}

/**
 * Hits of an arXiv Atom feed.
 *
 * @param text - Atom XML.
 * @returns Hits (the "error" entry arXiv sends for bad queries is dropped).
 * @throws Error when the XML is invalid.
 */
export function parseArxivHits(text: string): SearchHit[] {
  return findAll(parseXml(text), ATOM_NS, [{ name: 'entry' }])
    .map(arxivEntryToHit)
    .filter((hit) => hit.info.title !== '' && hit.info.title !== 'Error');
}

/**
 * Convert a CrossRef work into a hit.
 *
 * @param raw - Work.
 * @returns Hit.
 */
export function crossrefToHit(raw: unknown): SearchHit {
  const item = asJson(raw);
  const info = crossrefToInfo(raw);
  const pdfUrls = asArray(item['link'])
    .map(asJson)
    .filter((link) => asText(link['content-type']) === 'application/pdf')
    .map((link) => asText(link['URL']));
  const count = item['is-referenced-by-count'];
  return {
    key: hitKey(info),
    info,
    abstract: collapse(asText(item['abstract']).replace(JATS_TAG, ' ')).replace(
      ABSTRACT_PREFIX,
      '',
    ),
    citedBy: typeof count === 'number' ? count : null,
    pdfUrls: unique(pdfUrls),
    openAccess: false,
    sources: ['crossref'],
    published: info.year,
    reasons: [],
  };
}

/**
 * Overlay non-empty text fields (base wins, override fills gaps).
 *
 * @param base - Preferred metadata.
 * @param extra - Gap filler.
 * @returns Merged metadata.
 */
function fillInfo(base: PaperInfo, extra: PaperInfo): PaperInfo {
  const merged = { ...base } as Record<keyof PaperInfo, string | boolean>;
  (Object.keys(base) as (keyof PaperInfo)[]).forEach((field) => {
    if (merged[field] === '' && extra[field] !== '') {
      merged[field] = extra[field];
    }
  });
  return merged as unknown as PaperInfo;
}

/**
 * Merge two hits describing the same paper.
 *
 * @param base - Hit seen first (its metadata wins).
 * @param extra - Duplicate.
 * @returns Merged hit.
 */
export function mergeHits(base: SearchHit, extra: SearchHit): SearchHit {
  const citations = [base.citedBy, extra.citedBy].filter(
    (value): value is number => value !== null,
  );
  return {
    key: base.key,
    info: fillInfo(base.info, extra.info),
    abstract: base.abstract.length >= extra.abstract.length ? base.abstract : extra.abstract,
    citedBy: citations.length === 0 ? null : Math.max(...citations),
    pdfUrls: unique([...base.pdfUrls, ...extra.pdfUrls]),
    openAccess: base.openAccess || extra.openAccess,
    sources: [...new Set([...base.sources, ...extra.sources])],
    published: base.published.length >= extra.published.length ? base.published : extra.published,
    reasons: unique([...base.reasons, ...extra.reasons]),
  };
}

/**
 * Whether two hits describe the same paper.
 *
 * @param left - Hit.
 * @param right - Hit.
 * @returns Same paper.
 */
function sameHit(left: SearchHit, right: SearchHit): boolean {
  if (left.key === right.key) {
    return true;
  }
  const yearsAgree =
    left.info.year === '' || right.info.year === '' || left.info.year === right.info.year;
  return yearsAgree && titlesMatch(left.info.title, right.info.title);
}

/**
 * Interleave ranked lists from several sources, merging duplicates.
 *
 * @param lists - One ranked list per source.
 * @param existing - Hits already shown (kept first, merged with new duplicates).
 * @returns Combined hits.
 */
export function combineHits(
  lists: readonly (readonly SearchHit[])[],
  existing: readonly SearchHit[] = [],
): SearchHit[] {
  const combined = [...existing];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank += 1) {
    lists.forEach((list) => {
      const hit = list[rank];
      if (hit === undefined || hit.info.title === '') {
        return;
      }
      const index = combined.findIndex((other) => sameHit(other, hit));
      const duplicate = combined[index];
      if (duplicate === undefined) {
        combined.push(hit);
      } else {
        combined[index] = mergeHits(duplicate, hit);
      }
    });
  }
  return combined;
}

/**
 * Apply the year range and PDF filter (sources ignoring them server-side).
 *
 * @param hits - Hits.
 * @param query - Query.
 * @returns Kept hits.
 */
export function filterHits(hits: readonly SearchHit[], query: SearchQuery): SearchHit[] {
  return hits.filter((hit) => {
    const year = Number(findYear(hit.info.year));
    if (query.withPdfOnly && hit.pdfUrls.length === 0) {
      return false;
    }
    if (year === 0) {
      return query.yearFrom === null && query.yearTo === null;
    }
    return (
      (query.yearFrom === null || year >= query.yearFrom) &&
      (query.yearTo === null || year <= query.yearTo)
    );
  });
}

/** Comparator of each non-relevance order. */
const HIT_ORDERS: Readonly<
  Record<Exclude<SearchSort, 'relevance'>, (left: SearchHit, right: SearchHit) => number>
> = {
  citations: (left, right) => (right.citedBy ?? -1) - (left.citedBy ?? -1),
  newest: (left, right) => right.published.localeCompare(left.published),
  oldest: (left, right) => (left.published || '9999').localeCompare(right.published || '9999'),
  title: (left, right) => left.info.title.localeCompare(right.info.title),
  pdf: (left, right) => Number(right.pdfUrls.length > 0) - Number(left.pdfUrls.length > 0),
};

/**
 * Order hits (relevance keeps the source ranks; ties keep it too).
 *
 * @param hits - Hits.
 * @param sort - Order.
 * @returns Sorted copy.
 */
export function sortHits(hits: readonly SearchHit[], sort: SearchSort): SearchHit[] {
  return sort === 'relevance' ? [...hits] : [...hits].sort(HIT_ORDERS[sort]);
}

/**
 * Library paper matching a hit (same DOI, or same title and year).
 *
 * @param hit - Hit.
 * @param papers - Library.
 * @returns Paper, or null.
 */
export function findInLibrary(hit: SearchHit, papers: readonly Paper[]): Paper | null {
  const doi = hit.info.doi.toLowerCase();
  return (
    papers.find(
      (paper) =>
        (doi !== '' && paper.info.doi.toLowerCase() === doi) ||
        (titlesMatch(paper.info.title, hit.info.title) &&
          (paper.info.year === '' || hit.info.year === '' || paper.info.year === hit.info.year)),
    ) ?? null
  );
}

/**
 * File name of an imported PDF: `Family_Year_First-title-words.pdf`.
 *
 * @param info - Metadata.
 * @returns Safe file name.
 */
export function hitFileName(info: PaperInfo): string {
  const family = (info.authors.split('|')[0] ?? '').split(',')[0] ?? '';
  const words = normalizeTitle(info.title).split(' ').filter(Boolean).slice(0, FILE_TITLE_WORDS);
  const stem = [normalizeTitle(family).replaceAll(' ', '-'), info.year, words.join('-')]
    .filter(Boolean)
    .join('_')
    .slice(0, FILE_NAME_MAX);
  return `${stem || 'paper'}.pdf`;
}

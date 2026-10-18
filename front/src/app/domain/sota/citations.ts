import { displayTitle, type Paper } from './paper';
import { asArray, asJson, asText } from './sources';
import { normalizeTitle, titlesMatch } from './text';
import { findAll, findFirst, parseXml, TEI_NS, xmlText } from './xml';

/** References of one library paper (OpenAlex ids, `doi:` keys or `t:` title keys), stored in `sota_refs_*`. */
export interface CitationRecord {
  readonly openalex_id: string;
  readonly references: readonly string[];
  readonly cited_by_count: number;
  readonly source: string;
}

/** Work outside the library cited by several library papers. */
export interface ExternalWork {
  readonly openalexId: string;
  readonly title: string;
  readonly year: string;
  readonly firstAuthor: string;
  readonly doi: string;
  readonly citedByCount: number;
  readonly libraryCitations: number;
}

/** Citation inside the library. */
export interface CitationEdge {
  readonly citing: string;
  readonly cited: string;
}

/** Sources of the analysis (injected). */
export interface CitationSources {
  readonly openalexByDoi: (doi: string) => Promise<CitationRecord | null>;
  readonly openalexByTitle: (title: string) => Promise<CitationRecord | null>;
  readonly grobidReferences: (path: string) => Promise<string[]>;
  readonly onError?: (source: string, error: unknown) => void;
}

/** Empty record. */
export const EMPTY_RECORD: CitationRecord = {
  openalex_id: '',
  references: [],
  cited_by_count: 0,
  source: '',
};

const OPENALEX_ID_PREFIX = 'https://openalex.org/';
const DOI_REF_PREFIX = 'doi:';
const TITLE_REF_PREFIX = 't:';
const TITLE_KEY_LENGTH = 60;
/** References kept per paper. */
export const MAX_STORED_REFERENCES = 150;
const PDF_EXTENSION = '.pdf';

/**
 * Parse a stored record.
 *
 * @param raw - Stored object.
 * @returns Record.
 */
export function citationRecordFromDict(raw: unknown): CitationRecord {
  const source = asJson(raw);
  return {
    openalex_id: asText(source['openalex_id']),
    references: asArray(source['references']).map((reference) => String(reference)),
    cited_by_count: Number(source['cited_by_count'] ?? 0) || 0,
    source: asText(source['source']),
  };
}

/**
 * Strip the OpenAlex URL prefix.
 *
 * @param id - `https://openalex.org/W123` or `W123`.
 * @returns `W123`.
 */
export function shortOpenalexId(id: string): string {
  return id.startsWith(OPENALEX_ID_PREFIX) ? id.slice(OPENALEX_ID_PREFIX.length) : id;
}

/**
 * Compact title reference key.
 *
 * @param title - Title.
 * @returns `t:` + truncated normalized title, empty for an empty title.
 */
export function titleKey(title: string): string {
  const normalized = normalizeTitle(title).slice(0, TITLE_KEY_LENGTH);
  return normalized === '' ? '' : `${TITLE_REF_PREFIX}${normalized}`;
}

/**
 * Convert an OpenAlex work into a record.
 *
 * @param raw - Work.
 * @returns Record.
 */
export function openalexToRecord(raw: unknown): CitationRecord {
  const work = asJson(raw);
  return {
    openalex_id: shortOpenalexId(asText(work['id'])),
    references: asArray(work['referenced_works'])
      .map((reference) => shortOpenalexId(asText(reference)))
      .slice(0, MAX_STORED_REFERENCES),
    cited_by_count: Number(work['cited_by_count'] ?? 0) || 0,
    source: 'openalex',
  };
}

/**
 * Best OpenAlex search result: matching title with the most references.
 *
 * @param results - Search results.
 * @param title - Searched title.
 * @returns Record, or null.
 */
export function bestOpenalexMatch(
  results: readonly unknown[],
  title: string,
): CitationRecord | null {
  const matches = results
    .map(asJson)
    .filter((work) => titlesMatch(asText(work['display_name']), title));
  if (matches.length === 0) {
    return null;
  }
  const best = matches.reduce((left, right) =>
    asArray(right['referenced_works']).length > asArray(left['referenced_works']).length
      ? right
      : left,
  );
  return openalexToRecord(best);
}

/**
 * Family name of the first author of an OpenAlex work.
 *
 * @param work - Work with authorships.
 * @returns Name, or empty.
 */
function firstAuthor(work: Readonly<Record<string, unknown>>): string {
  const name = asText(asJson(asJson(asArray(work['authorships'])[0])['author'])['display_name']);
  return name.split(/\s+/).filter(Boolean).at(-1) ?? '';
}

/**
 * Convert an OpenAlex work into an external work.
 *
 * @param raw - Work.
 * @param counts - OpenAlex id → citing library papers.
 * @returns External work.
 */
export function toExternalWork(raw: unknown, counts: ReadonlyMap<string, number>): ExternalWork {
  const work = asJson(raw);
  const id = shortOpenalexId(asText(work['id']));
  return {
    openalexId: id,
    title: asText(work['display_name']),
    year: asText(work['publication_year']),
    firstAuthor: firstAuthor(work),
    doi: asText(work['doi']).replace(/^https:\/\/doi\.org\//, ''),
    citedByCount: Number(work['cited_by_count'] ?? 0) || 0,
    libraryCitations: counts.get(id) ?? 0,
  };
}

/**
 * Reference keys of a GROBID bibliography (`/api/processReferences`).
 *
 * @param text - TEI XML.
 * @returns `doi:…` keys when known, else `t:…` title keys.
 * @throws Error when the XML is invalid.
 */
export function parseTeiReferences(text: string): string[] {
  const references = findAll(parseXml(text), TEI_NS, [
    { name: 'listBibl', deep: true },
    { name: 'biblStruct' },
  ]).flatMap((bibl) => {
    const doi = xmlText(
      findFirst(bibl, TEI_NS, [{ name: 'idno', deep: true, attr: ['type', 'DOI'] }]),
    ).toLowerCase();
    const title =
      xmlText(findFirst(bibl, TEI_NS, [{ name: 'analytic' }, { name: 'title' }])) ||
      xmlText(findFirst(bibl, TEI_NS, [{ name: 'monogr' }, { name: 'title' }]));
    const key = doi === '' ? titleKey(title) : `${DOI_REF_PREFIX}${doi}`;
    return key === '' ? [] : [key];
  });
  return references.slice(0, MAX_STORED_REFERENCES);
}

/**
 * Run a source, swallowing failures.
 *
 * @param name - Source name.
 * @param call - Call.
 * @param sources - Sources (error callback).
 * @returns Result, or null.
 */
async function safeCall<T>(
  name: string,
  call: () => Promise<T>,
  sources: CitationSources,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    sources.onError?.(name, error);
    return null;
  }
}

/**
 * Find a paper's references: OpenAlex by DOI or title, GROBID bibliography as fallback.
 *
 * @param paper - Paper.
 * @param sources - Sources.
 * @returns Record (`source: "none"` when nothing was found).
 */
export async function analyzePaper(
  paper: Paper,
  sources: CitationSources,
): Promise<CitationRecord> {
  const doi = paper.info.doi;
  let record =
    doi === '' ? null : await safeCall('openalex', () => sources.openalexByDoi(doi), sources);
  record ??= await safeCall(
    'openalex',
    () => sources.openalexByTitle(displayTitle(paper)),
    sources,
  );
  if (record !== null && record.references.length > 0) {
    return record;
  }
  const isPdf = paper.path.toLowerCase().endsWith(PDF_EXTENSION);
  const references = isPdf
    ? ((await safeCall('grobid', () => sources.grobidReferences(paper.path), sources)) ?? [])
    : [];
  const base = record ?? EMPTY_RECORD;
  if (references.length > 0) {
    return {
      openalex_id: base.openalex_id,
      references,
      cited_by_count: base.cited_by_count,
      source: 'grobid',
    };
  }
  return {
    openalex_id: base.openalex_id,
    references: [],
    cited_by_count: base.cited_by_count,
    source: base.source || 'none',
  };
}

/**
 * Every key a reference may use to designate a paper.
 *
 * @param paper - Paper.
 * @param record - Its record.
 * @returns OpenAlex id, DOI key and title key.
 */
function paperKeys(paper: Paper, record: CitationRecord | undefined): string[] {
  const keys = [titleKey(displayTitle(paper))];
  if (paper.info.doi !== '') {
    keys.push(`${DOI_REF_PREFIX}${paper.info.doi.toLowerCase()}`);
  }
  if (record !== undefined && record.openalex_id !== '') {
    keys.push(record.openalex_id);
  }
  return keys.filter(Boolean);
}

/**
 * Resolve references to library papers and count unresolved OpenAlex references.
 *
 * @param papers - Library.
 * @param records - Path → record.
 * @returns Edges inside the library, and external OpenAlex id → citing papers count.
 */
export function citationEdges(
  papers: readonly Paper[],
  records: ReadonlyMap<string, CitationRecord>,
): { edges: CitationEdge[]; external: Map<string, number> } {
  const index = new Map(
    papers.flatMap((paper) =>
      paperKeys(paper, records.get(paper.path)).map((key) => [key, paper.path] as const),
    ),
  );
  const edges = new Map<string, CitationEdge>();
  const external = new Map<string, number>();
  for (const paper of papers) {
    for (const reference of new Set(records.get(paper.path)?.references ?? [])) {
      const target = index.get(reference);
      if (target !== undefined && target !== paper.path) {
        edges.set(`${paper.path}\n${target}`, { citing: paper.path, cited: target });
      } else if (target === undefined && isOpenalexReference(reference)) {
        external.set(reference, (external.get(reference) ?? 0) + 1);
      }
    }
  }
  return { edges: [...edges.values()], external };
}

/**
 * Whether a reference is an OpenAlex id (not a DOI or title key).
 *
 * @param reference - Reference key.
 * @returns OpenAlex id.
 */
function isOpenalexReference(reference: string): boolean {
  return !reference.startsWith(DOI_REF_PREFIX) && !reference.startsWith(TITLE_REF_PREFIX);
}

/**
 * External works cited by at least `minCiting` library papers (most cited first).
 *
 * @param external - OpenAlex id → citing papers count.
 * @param minCiting - Minimum citing papers.
 * @param limit - Maximum works.
 * @returns OpenAlex id → count.
 */
export function sharedReferences(
  external: ReadonlyMap<string, number>,
  minCiting: number,
  limit: number,
): Map<string, number> {
  const ranked = [...external].sort((left, right) => right[1] - left[1]).slice(0, limit);
  return new Map(ranked.filter(([, count]) => count >= minCiting));
}

/**
 * Nodes reachable from `start` within `depth` hops, ignoring direction.
 *
 * @param pairs - Edge endpoints.
 * @param start - Start node.
 * @param depth - Maximum hops.
 * @returns Reached nodes (start included).
 */
export function neighborhood(
  pairs: readonly (readonly [string, string])[],
  start: string,
  depth: number,
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const [first, second] of pairs) {
    adjacency.set(first, (adjacency.get(first) ?? new Set()).add(second));
    adjacency.set(second, (adjacency.get(second) ?? new Set()).add(first));
  }
  const reached = new Set([start]);
  let frontier = new Set([start]);
  for (let hop = 0; hop < depth; hop++) {
    frontier = new Set(
      [...frontier]
        .flatMap((node) => [...(adjacency.get(node) ?? [])])
        .filter((node) => !reached.has(node)),
    );
    frontier.forEach((node) => reached.add(node));
  }
  return reached;
}

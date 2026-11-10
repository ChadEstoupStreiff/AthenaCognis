import { shortOpenalexId } from './citations';
import { type Paper, paperUploadDate } from './paper';
import { combineHits, findInLibrary, openalexToHit, type SearchHit } from './search';
import { asArray, asJson, asText } from './sources';

/** What the discovery is based on: library papers, the subject of the settings, or a typed text. */
export type DiscoverScope = 'library' | 'recent' | 'subject' | 'custom';

/** Scopes based on a text (subject or custom) rather than library papers. */
export type TextScope = Extract<DiscoverScope, 'subject' | 'custom'>;

/** Scopes based on library papers. */
export type PaperScope = Exclude<DiscoverScope, TextScope>;

/** Publication period: last N months, or a custom range. */
export type DiscoverPeriod = number | 'custom';

/** Discovery settings. */
export interface DiscoverRequest {
  readonly scope: DiscoverScope;
  readonly period: DiscoverPeriod;
  /** Custom range start (`YYYY-MM-DD`), null = open. */
  readonly from: string | null;
  /** Custom range end (`YYYY-MM-DD`), null = today. */
  readonly to: string | null;
  /** Text of the custom scope. */
  readonly custom: string;
}

/** Publication days searched (inclusive). */
export interface DiscoverRange {
  readonly from: string;
  readonly to: string;
}

/** Scope options in display order. */
export const DISCOVER_SCOPES: readonly { readonly label: string; readonly value: DiscoverScope }[] =
  [
    { label: 'My whole library', value: 'library' },
    { label: 'Papers I added in the last month', value: 'recent' },
    { label: 'My subject', value: 'subject' },
    { label: 'Custom', value: 'custom' },
  ];

/** Period options in display order. */
export const DISCOVER_PERIODS: readonly {
  readonly label: string;
  readonly value: DiscoverPeriod;
}[] = [
  { label: 'Last month', value: 1 },
  { label: 'Last 3 months', value: 3 },
  { label: 'Last 6 months', value: 6 },
  { label: 'Last year', value: 12 },
  { label: 'Custom range', value: 'custom' },
];

/** OpenAlex topic of the library, weighted by the number of seed papers carrying it. */
export interface SeedTopic {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/** Library paper resolved on OpenAlex. */
export interface SeedWork {
  readonly id: string;
  readonly topics: readonly Omit<SeedTopic, 'count'>[];
}

/** Recent work with its references and topics (raw OpenAlex work kept for the hit). */
export interface Candidate {
  readonly hit: SearchHit;
  readonly references: readonly string[];
  readonly topicIds: readonly string[];
}

const RECENT_SEED_DAYS = 30;
const DAY_MS = 86_400_000;
const CITE_WEIGHT = 3;
const MAX_REASON_TOPICS = 2;
const EARLIEST_DAY = '1900-01-01';
const DEFAULT_SCOPE: DiscoverScope = 'library';
const DEFAULT_PERIOD: DiscoverPeriod = 1;
/** Library papers listed to the AI at most (most recently added first). */
export const MAX_AI_SEED_PAPERS = 80;

/**
 * Papers seeding the discovery.
 *
 * @param papers - Library.
 * @param scope - Scope.
 * @param now - Today.
 * @returns Seed papers.
 */
export function seedPapers(papers: readonly Paper[], scope: PaperScope, now: Date): Paper[] {
  if (scope === 'library') {
    return [...papers];
  }
  const since = isoDate(new Date(now.getTime() - RECENT_SEED_DAYS * DAY_MS));
  return papers.filter((paper) => paperUploadDate(paper) >= since);
}

/**
 * `YYYY-MM-DD` of a date (UTC).
 *
 * @param date - Date.
 * @returns ISO day.
 */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, '2000-01-01'.length);
}

/**
 * First publication day of the period.
 *
 * @param months - Months back.
 * @param now - Today.
 * @returns `YYYY-MM-DD`.
 */
export function periodStart(months: number, now: Date): string {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - months);
  return isoDate(start);
}

/**
 * Publication days of a request (custom bounds are swapped when reversed).
 *
 * @param request - Request.
 * @param now - Today.
 * @returns Range.
 */
export function discoverRange(request: DiscoverRequest, now: Date): DiscoverRange {
  const today = periodStart(0, now);
  if (request.period !== 'custom') {
    return { from: periodStart(request.period, now), to: today };
  }
  const from = request.from ?? EARLIEST_DAY;
  const to = request.to ?? today;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Parse a seed work (`id,topics` OpenAlex selection).
 *
 * @param raw - Work.
 * @returns Seed.
 */
export function parseSeedWork(raw: unknown): SeedWork {
  const work = asJson(raw);
  return {
    id: shortOpenalexId(asText(work['id'])),
    topics: asArray(work['topics'])
      .map(asJson)
      .map((topic) => ({
        id: shortOpenalexId(asText(topic['id'])),
        name: asText(topic['display_name']),
      }))
      .filter((topic) => topic.id !== ''),
  };
}

/**
 * Most frequent topics of the seeds.
 *
 * @param seeds - Seeds.
 * @param limit - Topics kept.
 * @returns Topics, most frequent first.
 */
export function topTopics(seeds: readonly SeedWork[], limit: number): SeedTopic[] {
  const counts = new Map<string, SeedTopic>();
  seeds.forEach((seed) => {
    seed.topics.forEach((topic) => {
      const count = (counts.get(topic.id)?.count ?? 0) + 1;
      counts.set(topic.id, { ...topic, count });
    });
  });
  return [...counts.values()].sort((left, right) => right.count - left.count).slice(0, limit);
}

/**
 * Parse a recent OpenAlex work (hit fields + `referenced_works` + `topics`).
 *
 * @param raw - Work.
 * @returns Candidate.
 */
export function parseCandidate(raw: unknown): Candidate {
  const work = asJson(raw);
  return {
    hit: openalexToHit(raw),
    references: asArray(work['referenced_works']).map((id) => shortOpenalexId(asText(id))),
    topicIds: parseSeedWork(raw).topics.map((topic) => topic.id),
  };
}

/**
 * Score a candidate: cited seeds weigh most, then shared library topics.
 *
 * @param candidate - Candidate.
 * @param seedIds - OpenAlex ids of the seeds.
 * @param topics - Library topics.
 * @returns Score and reasons.
 */
function scoreCandidate(
  candidate: Candidate,
  seedIds: ReadonlySet<string>,
  topics: readonly SeedTopic[],
): { readonly score: number; readonly reasons: string[] } {
  const cited = candidate.references.filter((id) => seedIds.has(id)).length;
  const shared = topics.filter((topic) => candidate.topicIds.includes(topic.id));
  const reasons = [
    cited === 0 ? '' : `Cites ${String(cited)} of your paper${cited > 1 ? 's' : ''}`,
    ...shared.slice(0, MAX_REASON_TOPICS).map((topic) => `Topic: ${topic.name}`),
  ].filter(Boolean);
  return {
    score: cited * CITE_WEIGHT + shared.reduce((sum, topic) => sum + topic.count, 0),
    reasons,
  };
}

/**
 * Rank recent works related to the library (best first), dropping papers already in it.
 *
 * @param candidates - Recent works (duplicates allowed).
 * @param seeds - Seeds.
 * @param topics - Library topics.
 * @param papers - Library.
 * @returns Hits with their reasons.
 */
export function rankDiscoveries(
  candidates: readonly Candidate[],
  seeds: readonly SeedWork[],
  topics: readonly SeedTopic[],
  papers: readonly Paper[],
): SearchHit[] {
  const seedIds = new Set(seeds.map((seed) => seed.id));
  const unique = new Map<string, Candidate>();
  candidates.forEach((candidate) => unique.set(candidate.hit.key, candidate));
  return [...unique.values()]
    .filter((candidate) => findInLibrary(candidate.hit, papers) === null)
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate, seedIds, topics) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.candidate.hit.citedBy ?? 0) - (left.candidate.hit.citedBy ?? 0),
    )
    .map((entry) => ({ ...entry.candidate.hit, reasons: entry.reasons }));
}

/**
 * Hits of a text search, in relevance order, without library papers.
 *
 * @param candidates - Works found.
 * @param papers - Library.
 * @param reason - Reason shown on each hit.
 * @returns Hits.
 */
export function subjectHits(
  candidates: readonly Candidate[],
  papers: readonly Paper[],
  reason = 'Matches your subject',
): SearchHit[] {
  return candidates
    .map((candidate) => candidate.hit)
    .filter((hit) => findInLibrary(hit, papers) === null)
    .map((hit) => ({ ...hit, reasons: [reason] }));
}

/**
 * Whether a scope is based on a text.
 *
 * @param scope - Scope.
 * @returns Text scope.
 */
export function isTextScope(scope: DiscoverScope): scope is TextScope {
  return scope === 'subject' || scope === 'custom';
}

/**
 * Discovery request of the default selections stored in the settings (invalid values ignored).
 *
 * @param scope - Stored scope.
 * @param period - Stored period (`"1"`, `"3"`… months, or `"custom"`).
 * @returns Request.
 */
export function defaultDiscoverRequest(scope: string, period: string): DiscoverRequest {
  const knownScope = DISCOVER_SCOPES.find((option) => option.value === scope)?.value;
  const knownPeriod = DISCOVER_PERIODS.find((option) => String(option.value) === period)?.value;
  return {
    scope: knownScope ?? DEFAULT_SCOPE,
    period: knownPeriod ?? DEFAULT_PERIOD,
    from: null,
    to: null,
    custom: '',
  };
}

/**
 * Library papers described to the AI: `- Title (year)` lines, most recently added first.
 *
 * @param papers - Seed papers.
 * @returns Lines (empty when no paper has a title).
 */
export function aiPaperContext(papers: readonly Paper[]): string {
  return [...papers]
    .filter((paper) => paper.info.title.trim() !== '')
    .sort((left, right) => paperUploadDate(right).localeCompare(paperUploadDate(left)))
    .slice(0, MAX_AI_SEED_PAPERS)
    .map((paper) => {
      const year = paper.info.year.trim();
      return `- ${paper.info.title.trim()}${year === '' ? '' : ` (${year})`}`;
    })
    .join('\n');
}

/**
 * Tag each query's hits with the query number, then interleave and merge duplicates.
 *
 * @param lists - Hits of each AI query, in query order.
 * @param papers - Library (excluded).
 * @returns Hits, reasons `AI query N` (several when found by several queries).
 */
export function aiQueryHits(
  lists: readonly (readonly SearchHit[])[],
  papers: readonly Paper[],
): SearchHit[] {
  const tagged = lists.map((list, index) =>
    list.map((hit) => ({ ...hit, reasons: [`AI query ${String(index + 1)}`] })),
  );
  return combineHits(tagged).filter((hit) => findInLibrary(hit, papers) === null);
}

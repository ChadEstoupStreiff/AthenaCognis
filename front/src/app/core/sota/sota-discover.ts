import { inject, Injectable } from '@angular/core';
import {
  asArray,
  asJson,
  type Candidate,
  type DiscoverRange,
  type Paper,
  parseCandidate,
  parseSeedWork,
  rankDiscoveries,
  subjectHits,
  type SearchHit,
  type SeedTopic,
  type SeedWork,
  topTopics,
} from '@domain/sota';
import { getJson, OPENALEX_URL } from './http';
import { OPENALEX_SELECT } from './sota-search';
import { SotaStorage } from './sota-storage';

/** What a discovery found. */
export interface DiscoverOutcome {
  readonly hits: readonly SearchHit[];
  /** Seed papers found on OpenAlex. */
  readonly resolved: number;
  /** Library topics used. */
  readonly topics: readonly SeedTopic[];
}

/** OpenAlex OR-filters accept up to 100 values; keep URLs short. */
const FILTER_BATCH = 50;
const CANDIDATES_PER_QUERY = 50;
const TOPIC_LIMIT = 5;
const SEED_SELECT = 'id,topics';
const CANDIDATE_SELECT = `${OPENALEX_SELECT},referenced_works,topics`;
/** Characters that would break an OpenAlex filter value. */
const FILTER_UNSAFE = /[|,]/;

/**
 * Split a list into batches.
 *
 * @param items - Items.
 * @param size - Batch size.
 * @returns Batches.
 */
function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

/** Recent papers related to the library: works citing it, and works on its main topics. */
@Injectable({ providedIn: 'root' })
export class SotaDiscover {
  private readonly storage = inject(SotaStorage);

  /**
   * Find recent works related to seed papers.
   *
   * @param seeds - Seed papers.
   * @param library - Whole library (excluded from results).
   * @param range - Publication days.
   * @returns Ranked hits.
   * @throws Error when no seed paper is known to OpenAlex.
   */
  async discover(
    seeds: readonly Paper[],
    library: readonly Paper[],
    range: DiscoverRange,
  ): Promise<DiscoverOutcome> {
    const works = await this.resolveSeeds(seeds);
    if (works.length === 0) {
      throw new Error(
        'None of these papers was found on OpenAlex. Add their DOI (Library → Find info) first.',
      );
    }
    const topics = topTopics(works, TOPIC_LIMIT);
    const queries = [
      ...batches(
        works.map((work) => work.id),
        FILTER_BATCH,
      ).map((ids) =>
        this.candidates({ filter: `cites:${ids.join('|')}` }, range, 'publication_date:desc'),
      ),
      topics.length === 0
        ? Promise.resolve([])
        : this.candidates(
            { filter: `topics.id:${topics.map((topic) => topic.id).join('|')}` },
            range,
            'cited_by_count:desc',
          ),
    ];
    const candidates = (await Promise.all(queries)).flat();
    return {
      hits: rankDiscoveries(candidates, works, topics, library),
      resolved: works.length,
      topics,
    };
  }

  /**
   * Find works matching the subject written in the settings.
   *
   * @param subject - Subject (free text).
   * @param library - Whole library (excluded from results).
   * @param range - Publication days.
   * @returns Hits, most relevant first.
   */
  async bySubject(
    subject: string,
    library: readonly Paper[],
    range: DiscoverRange,
  ): Promise<DiscoverOutcome> {
    const candidates = await this.candidates({ search: subject }, range, null);
    return {
      hits: subjectHits(candidates, library),
      resolved: 0,
      topics: [],
    };
  }

  /**
   * OpenAlex works of the seed papers (stored citation ids first, then DOIs).
   *
   * @param seeds - Seed papers.
   * @returns Works.
   */
  private async resolveSeeds(seeds: readonly Paper[]): Promise<SeedWork[]> {
    const records = await this.storage.records(seeds);
    const ids = seeds
      .map((paper) => records.get(paper.path)?.openalex_id ?? '')
      .filter((id) => id !== '');
    const dois = seeds
      .filter((paper) => (records.get(paper.path)?.openalex_id ?? '') === '')
      .map((paper) => paper.info.doi.trim())
      .filter((doi) => doi !== '' && !FILTER_UNSAFE.test(doi));
    const lookups = [
      ...batches(ids, FILTER_BATCH).map((batch) =>
        this.seedWorks(`openalex_id:${batch.join('|')}`),
      ),
      ...batches(dois, FILTER_BATCH).map((batch) => this.seedWorks(`doi:${batch.join('|')}`)),
    ];
    const works = (await Promise.all(lookups)).flat();
    return [...new Map(works.map((work) => [work.id, work])).values()];
  }

  /**
   * Seed works matching a filter.
   *
   * @param filter - OpenAlex filter.
   * @returns Works.
   */
  private async seedWorks(filter: string): Promise<SeedWork[]> {
    const body = await getJson(OPENALEX_URL, {
      filter,
      select: SEED_SELECT,
      'per-page': FILTER_BATCH,
    });
    return asArray(asJson(body)['results']).map(parseSeedWork);
  }

  /**
   * Works of a period matching a filter or a full-text search.
   *
   * @param criteria - OpenAlex filter (without the date) and/or search text.
   * @param criteria.filter - OpenAlex filter, without the date.
   * @param criteria.search - Full-text search.
   * @param range - Publication days.
   * @param sort - OpenAlex sort, null for relevance.
   * @returns Candidates.
   */
  private async candidates(
    criteria: { readonly filter?: string; readonly search?: string },
    range: DiscoverRange,
    sort: string | null,
  ): Promise<Candidate[]> {
    const dates = `from_publication_date:${range.from},to_publication_date:${range.to}`;
    const body = await getJson(OPENALEX_URL, {
      filter: criteria.filter === undefined ? dates : `${criteria.filter},${dates}`,
      select: CANDIDATE_SELECT,
      'per-page': CANDIDATES_PER_QUERY,
      ...(criteria.search === undefined ? {} : { search: criteria.search }),
      ...(sort === null ? {} : { sort }),
    });
    return asArray(asJson(body)['results']).map(parseCandidate);
  }
}

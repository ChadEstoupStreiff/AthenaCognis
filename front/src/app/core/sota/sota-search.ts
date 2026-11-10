import { Injectable } from '@angular/core';
import {
  asArray,
  asJson,
  crossrefToHit,
  openalexToHit,
  type PaperIdentifier,
  parseArxivHits,
  parseIdentifier,
  type SearchHit,
  type SearchQuery,
  type SearchSource,
  SOURCE_LABELS,
} from '@domain/sota';
import { backendUrl } from '../api/api-client';
import { ARXIV_URL, CROSSREF_URL, doiPath, getJson, OPENALEX_URL, request } from './http';

/** Results asked to each source per page. */
export const RESULTS_PER_SOURCE = 15;

/** OpenAlex fields of a search hit. */
export const OPENALEX_SELECT = [
  'id',
  'doi',
  'display_name',
  'publication_year',
  'publication_date',
  'cited_by_count',
  'authorships',
  'primary_location',
  'best_oa_location',
  'locations',
  'open_access',
  'biblio',
  'abstract_inverted_index',
].join(',');
const CROSSREF_SELECT = [
  'DOI',
  'URL',
  'title',
  'author',
  'issued',
  'published-print',
  'published-online',
  'container-title',
  'volume',
  'issue',
  'page',
  'is-referenced-by-count',
  'abstract',
  'link',
].join(',');
const FETCH_URL = backendUrl('/research/fetch');
const PDF_TIMEOUT_MS = 180_000;
const ARXIV_WORD = /[^\p{L}\p{N}-]+/u;
const ARXIV_DOI_PREFIX = '10.48550/arXiv.';
const ARXIV_FIRST_YEAR = 1991;
/** CrossRef record types that are papers (drops figures, components, datasets…). */
const CROSSREF_TYPES = ['journal-article', 'proceedings-article', 'posted-content', 'book-chapter'];

/** A source that could not answer. */
export interface SourceFailure {
  readonly source: SearchSource;
  readonly message: string;
}

/** Raw answer of one search page. */
export interface SearchPage {
  /** One ranked list per answering source. */
  readonly lists: readonly (readonly SearchHit[])[];
  readonly failures: readonly SourceFailure[];
  /** No source has more results. */
  readonly exhausted: boolean;
}

/**
 * Readable message of a failure.
 *
 * @param error - Error.
 * @returns Message.
 */
function messageOf(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'timed out';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Error detail of a failed backend answer (FastAPI `{detail}`).
 *
 * @param response - Response.
 * @returns Message.
 */
async function detailOf(response: Response): Promise<string> {
  try {
    const detail = asJson(await response.json())['detail'];
    return typeof detail === 'string' ? detail : `HTTP ${String(response.status)}`;
  } catch {
    return `HTTP ${String(response.status)}`;
  }
}

/**
 * OpenAlex `filter` parameter of a query.
 *
 * @param query - Query.
 * @returns Filter, empty when none.
 */
function openalexFilter(query: SearchQuery): string {
  return [
    query.yearFrom === null ? '' : `from_publication_date:${String(query.yearFrom)}-01-01`,
    query.yearTo === null ? '' : `to_publication_date:${String(query.yearTo)}-12-31`,
    query.withPdfOnly ? 'is_oa:true' : '',
  ]
    .filter(Boolean)
    .join(',');
}

/**
 * arXiv `search_query` of a query (every word, optional date range).
 *
 * @param query - Query.
 * @returns Search expression.
 */
function arxivExpression(query: SearchQuery): string {
  const words = query.text
    .split(ARXIV_WORD)
    .filter(Boolean)
    .map((word) => `all:${word}`);
  if (query.yearFrom !== null || query.yearTo !== null) {
    const from = String(query.yearFrom ?? ARXIV_FIRST_YEAR);
    const to = String(query.yearTo ?? new Date().getFullYear());
    words.push(`submittedDate:[${from}01010000 TO ${to}12312359]`);
  }
  return words.join(' AND ');
}

/** Paper search over OpenAlex, arXiv and CrossRef, and PDF download through the backend. */
@Injectable({ providedIn: 'root' })
export class SotaSearch {
  /**
   * Search one page on the selected sources (or resolve a typed DOI / arXiv id).
   *
   * @param query - Query.
   * @returns Ranked lists and failures.
   */
  async search(query: SearchQuery): Promise<SearchPage> {
    const identifier = parseIdentifier(query.text);
    const tasks: { source: SearchSource; run: () => Promise<SearchHit[]> }[] =
      identifier === null
        ? query.sources.map((source) => ({ source, run: () => this.searchSource(source, query) }))
        : this.identifierTasks(identifier);
    const settled = await Promise.allSettled(tasks.map((task) => task.run()));
    const lists: SearchHit[][] = [];
    const failures: SourceFailure[] = [];
    settled.forEach((outcome, index) => {
      const source = tasks[index]?.source ?? 'openalex';
      if (outcome.status === 'fulfilled') {
        lists.push(outcome.value);
      } else {
        failures.push({
          source,
          message: `${SOURCE_LABELS[source]}: ${messageOf(outcome.reason)}`,
        });
      }
    });
    const exhausted =
      identifier !== null || lists.every((list) => list.length < RESULTS_PER_SOURCE);
    return { lists, failures, exhausted };
  }

  /**
   * Download the PDF of a hit: each PDF link, then the publisher page (the backend follows its `citation_pdf_url`).
   *
   * @param hit - Hit.
   * @returns PDF.
   * @throws Error with the last failure when no candidate gives a PDF.
   */
  async downloadPdf(hit: SearchHit): Promise<Blob> {
    const candidates = [...new Set([...hit.pdfUrls, hit.info.url].filter(Boolean))];
    let lastError = 'No PDF link known for this paper.';
    for (const url of candidates) {
      try {
        return await this.fetchPdf(url);
      } catch (error) {
        lastError = messageOf(error);
      }
    }
    throw new Error(lastError);
  }

  /**
   * Download one URL through the backend.
   *
   * @param url - PDF or landing page.
   * @returns PDF.
   * @throws Error when the backend could not get a PDF.
   */
  private async fetchPdf(url: string): Promise<Blob> {
    const response = await fetch(`${FETCH_URL}?${new URLSearchParams({ url }).toString()}`, {
      signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(await detailOf(response));
    }
    return response.blob();
  }

  /**
   * Search one source.
   *
   * @param source - Source.
   * @param query - Query.
   * @returns Ranked hits.
   */
  private searchSource(source: SearchSource, query: SearchQuery): Promise<SearchHit[]> {
    if (source === 'arxiv') {
      return this.arxiv(query);
    }
    return source === 'crossref' ? this.crossref(query) : this.openalex(query);
  }

  /**
   * Lookups of a typed identifier.
   *
   * @param identifier - DOI or arXiv id.
   * @returns Tasks.
   */
  private identifierTasks(
    identifier: PaperIdentifier,
  ): { source: SearchSource; run: () => Promise<SearchHit[]> }[] {
    if (identifier.kind === 'arxiv') {
      return [
        { source: 'arxiv', run: () => this.arxivById(identifier.value) },
        {
          source: 'openalex',
          run: () => this.openalexByDoi(`${ARXIV_DOI_PREFIX}${identifier.value}`),
        },
      ];
    }
    return [
      { source: 'openalex', run: () => this.openalexByDoi(identifier.value) },
      { source: 'crossref', run: () => this.crossrefByDoi(identifier.value) },
    ];
  }

  /**
   * OpenAlex full-text search.
   *
   * @param query - Query.
   * @returns Hits.
   */
  private async openalex(query: SearchQuery): Promise<SearchHit[]> {
    const filter = openalexFilter(query);
    const body = await getJson(OPENALEX_URL, {
      search: query.text,
      select: OPENALEX_SELECT,
      'per-page': RESULTS_PER_SOURCE,
      page: query.page,
      ...(filter === '' ? {} : { filter }),
    });
    return asArray(asJson(body)['results']).map(openalexToHit);
  }

  /**
   * OpenAlex work of a DOI.
   *
   * @param doi - DOI.
   * @returns Zero or one hit.
   */
  private async openalexByDoi(doi: string): Promise<SearchHit[]> {
    const body = await getJson(`${OPENALEX_URL}/doi:${doiPath(doi)}`, { select: OPENALEX_SELECT });
    return body === null ? [] : [openalexToHit(body)];
  }

  /**
   * CrossRef full-text search.
   *
   * @param query - Query.
   * @returns Hits.
   */
  private async crossref(query: SearchQuery): Promise<SearchHit[]> {
    const filter = [
      ...CROSSREF_TYPES.map((type) => `type:${type}`),
      query.yearFrom === null ? '' : `from-pub-date:${String(query.yearFrom)}`,
      query.yearTo === null ? '' : `until-pub-date:${String(query.yearTo)}-12-31`,
    ]
      .filter(Boolean)
      .join(',');
    const body = await getJson(CROSSREF_URL, {
      query: query.text,
      select: CROSSREF_SELECT,
      rows: RESULTS_PER_SOURCE,
      offset: (query.page - 1) * RESULTS_PER_SOURCE,
      filter,
    });
    return asArray(asJson(asJson(body)['message'])['items']).map(crossrefToHit);
  }

  /**
   * CrossRef work of a DOI.
   *
   * @param doi - DOI.
   * @returns Zero or one hit.
   */
  private async crossrefByDoi(doi: string): Promise<SearchHit[]> {
    const body = await getJson(`${CROSSREF_URL}/${doiPath(doi)}`);
    return body === null ? [] : [crossrefToHit(asJson(body)['message'])];
  }

  /**
   * arXiv search.
   *
   * @param query - Query.
   * @returns Hits.
   */
  private async arxiv(query: SearchQuery): Promise<SearchHit[]> {
    const expression = arxivExpression(query);
    if (expression === '') {
      return [];
    }
    return this.arxivFeed({
      search_query: expression,
      start: String((query.page - 1) * RESULTS_PER_SOURCE),
      max_results: String(RESULTS_PER_SOURCE),
    });
  }

  /**
   * arXiv entry of an id.
   *
   * @param id - arXiv id.
   * @returns Zero or one hit.
   */
  private arxivById(id: string): Promise<SearchHit[]> {
    return this.arxivFeed({ id_list: id, max_results: '1' });
  }

  /**
   * Query the arXiv Atom API.
   *
   * @param params - Query parameters.
   * @returns Hits.
   */
  private async arxivFeed(params: Record<string, string>): Promise<SearchHit[]> {
    const response = await request(`${ARXIV_URL}?${new URLSearchParams(params).toString()}`);
    return response === null ? [] : parseArxivHits(await response.text());
  }
}

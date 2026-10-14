import { inject, Injectable } from '@angular/core';
import {
  asArray,
  asJson,
  bestOpenalexMatch,
  type CitationRecord,
  type CitationSources,
  crossrefToInfo,
  type ExternalWork,
  type LookupSources,
  openalexToRecord,
  type PaperInfo,
  parseArxivFeed,
  parseTeiHeader,
  parseTeiReferences,
  pubmedToInfo,
  toExternalWork,
} from '@domain/sota';
import { FilesApi } from '../files/files.api';
import { Logger } from '../logging/logger.service';

const CROSSREF_URL = 'https://api.crossref.org/works';
const PUBMED_SEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const PUBMED_SUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
const OPENALEX_URL = 'https://api.openalex.org/works';
/** Same-origin proxies (nginx): GROBID container and arXiv (no CORS upstream). */
const GROBID_URL = '/grobid/api';
const ARXIV_URL = '/arxiv/api/query';
const OPENALEX_FIELDS = 'id,doi,display_name,publication_year,cited_by_count,referenced_works';
const OPENALEX_EXTERNAL_FIELDS = 'id,doi,display_name,publication_year,cited_by_count,authorships';
const SEARCH_CANDIDATES = 3;
const OPENALEX_CANDIDATES = 5;
const OPENALEX_BATCH = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const GROBID_TIMEOUT_MS = 120_000;
const NOT_FOUND = 404;

/** HTTP failure of an external source. */
export class SourceError extends Error {
  /**
   * Build the error.
   *
   * @param status - HTTP status.
   * @param url - Requested URL.
   */
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`${new URL(url, location.origin).host} answered ${String(status)}.`);
    this.name = 'SourceError';
  }
}

/**
 * Fetch with a timeout, failing on HTTP errors (404 → null).
 *
 * @param url - URL.
 * @param init - Request.
 * @param timeoutMs - Timeout.
 * @returns Response, or null on 404.
 * @throws SourceError on other HTTP errors.
 */
async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response | null> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === NOT_FOUND) {
    return null;
  }
  if (!response.ok) {
    throw new SourceError(response.status, url);
  }
  return response;
}

/**
 * GET JSON.
 *
 * @param url - URL.
 * @param params - Query.
 * @returns Body, or null on 404.
 */
async function getJson(
  url: string,
  params: Record<string, string | number> = {},
): Promise<unknown> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await request(query.size > 0 ? `${url}?${query.toString()}` : url);
  return response === null ? null : ((await response.json()) as unknown);
}

/**
 * Encode a DOI for a URL path (slashes kept, like Python's `quote`).
 *
 * @param doi - DOI.
 * @returns Path segment.
 */
function doiPath(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/');
}

/** GROBID, CrossRef, PubMed, arXiv and OpenAlex clients for the Research library. */
@Injectable({ providedIn: 'root' })
export class SotaOnline {
  private readonly files = inject(FilesApi);
  private readonly logger = inject(Logger);

  /** Sources of the metadata lookup. */
  readonly lookup: LookupSources = {
    grobidHeader: (path) => this.grobidHeader(path),
    crossrefByDoi: (doi) => this.crossrefByDoi(doi),
    titleSearchers: [
      (title: string): Promise<PaperInfo[]> => this.crossrefByTitle(title),
      (title: string): Promise<PaperInfo[]> => this.pubmedByTitle(title),
      (title: string): Promise<PaperInfo[]> => this.arxivByTitle(title),
    ],
    onError: (source, error) => {
      this.logger.warn(`Lookup source ${source} failed`, error);
    },
  };

  /** Sources of the citation analysis. */
  readonly citations: CitationSources = {
    openalexByDoi: (doi) => this.openalexByDoi(doi),
    openalexByTitle: (title) => this.openalexByTitle(title),
    grobidReferences: (path) => this.grobidReferences(path),
    onError: (source, error) => {
      this.logger.warn(`Citation source ${source} failed`, error);
    },
  };

  /**
   * Metadata of shared external works, by batches.
   *
   * @param counts - OpenAlex id → citing library papers.
   * @returns Works.
   */
  async externalWorks(counts: ReadonlyMap<string, number>): Promise<ExternalWork[]> {
    const ids = [...counts.keys()];
    const works: ExternalWork[] = [];
    for (let start = 0; start < ids.length; start += OPENALEX_BATCH) {
      const batch = ids.slice(start, start + OPENALEX_BATCH);
      const body = await getJson(OPENALEX_URL, {
        filter: `openalex_id:${batch.join('|')}`,
        select: OPENALEX_EXTERNAL_FIELDS,
        'per-page': OPENALEX_BATCH,
      });
      works.push(...asArray(asJson(body)['results']).map((work) => toExternalWork(work, counts)));
    }
    return works;
  }

  /**
   * Send a PDF to GROBID.
   *
   * @param path - PDF.
   * @param service - GROBID service.
   * @param options - Form options.
   * @returns TEI XML (empty when GROBID found nothing).
   */
  private async grobid(
    path: string,
    service: string,
    options: Record<string, string>,
  ): Promise<string> {
    const pdf = await request(this.files.contentUrl(path), {}, GROBID_TIMEOUT_MS);
    if (pdf === null) {
      return '';
    }
    const form = new FormData();
    form.append('input', await pdf.blob(), 'paper.pdf');
    Object.entries(options).forEach(([key, value]) => {
      form.append(key, value);
    });
    const response = await request(
      `${GROBID_URL}/${service}`,
      { method: 'POST', body: form, headers: { accept: 'application/xml' } },
      GROBID_TIMEOUT_MS,
    );
    return response === null ? '' : (await response.text()).trim();
  }

  /**
   * PDF header read by GROBID (consolidated with CrossRef).
   *
   * @param path - PDF.
   * @returns Metadata, or null when GROBID finds no header.
   */
  private async grobidHeader(path: string): Promise<PaperInfo | null> {
    const tei = await this.grobid(path, 'processHeaderDocument', { consolidateHeader: '1' });
    if (tei === '') {
      return null;
    }
    const info = parseTeiHeader(tei);
    return info.title !== '' || info.doi !== '' ? info : null;
  }

  /**
   * Bibliography of a PDF read by GROBID.
   *
   * @param path - PDF.
   * @returns Reference keys.
   */
  private async grobidReferences(path: string): Promise<string[]> {
    const tei = await this.grobid(path, 'processReferences', { consolidateCitations: '0' });
    return tei === '' ? [] : parseTeiReferences(tei);
  }

  /**
   * CrossRef record of a DOI.
   *
   * @param doi - DOI.
   * @returns Metadata, or null.
   */
  private async crossrefByDoi(doi: string): Promise<PaperInfo | null> {
    const body = await getJson(`${CROSSREF_URL}/${doiPath(doi)}`);
    return body === null ? null : crossrefToInfo(asJson(body)['message']);
  }

  /**
   * CrossRef candidates for a title.
   *
   * @param title - Title.
   * @returns Candidates.
   */
  private async crossrefByTitle(title: string): Promise<PaperInfo[]> {
    const body = await getJson(CROSSREF_URL, {
      'query.bibliographic': title,
      rows: SEARCH_CANDIDATES,
    });
    return asArray(asJson(asJson(body)['message'])['items']).map(crossrefToInfo);
  }

  /**
   * PubMed candidates for a title.
   *
   * @param title - Title.
   * @returns Candidates.
   */
  private async pubmedByTitle(title: string): Promise<PaperInfo[]> {
    const search = await getJson(PUBMED_SEARCH_URL, {
      db: 'pubmed',
      term: `${title}[Title]`,
      retmax: SEARCH_CANDIDATES,
      retmode: 'json',
    });
    const ids = asArray(asJson(asJson(search)['esearchresult'])['idlist']).map(String);
    if (ids.length === 0) {
      return [];
    }
    const summary = asJson(
      asJson(
        await getJson(PUBMED_SUMMARY_URL, { db: 'pubmed', id: ids.join(','), retmode: 'json' }),
      )['result'],
    );
    return ids.filter((id) => id in summary).map((id) => pubmedToInfo(id, summary[id]));
  }

  /**
   * arXiv candidates for a title.
   *
   * @param title - Title.
   * @returns Candidates.
   */
  private async arxivByTitle(title: string): Promise<PaperInfo[]> {
    const query = new URLSearchParams({
      search_query: `ti:"${title.replaceAll('"', '')}"`,
      max_results: String(SEARCH_CANDIDATES),
    });
    const response = await request(`${ARXIV_URL}?${query.toString()}`);
    return response === null ? [] : parseArxivFeed(await response.text());
  }

  /**
   * OpenAlex record of a DOI.
   *
   * @param doi - DOI.
   * @returns Record, or null.
   */
  private async openalexByDoi(doi: string): Promise<CitationRecord | null> {
    const body = await getJson(`${OPENALEX_URL}/doi:${doiPath(doi)}`, { select: OPENALEX_FIELDS });
    return body === null ? null : openalexToRecord(body);
  }

  /**
   * OpenAlex record of a title (matching version with most references).
   *
   * @param title - Title.
   * @returns Record, or null.
   */
  private async openalexByTitle(title: string): Promise<CitationRecord | null> {
    const body = await getJson(OPENALEX_URL, {
      search: title,
      'per-page': OPENALEX_CANDIDATES,
      select: OPENALEX_FIELDS,
    });
    return bestOpenalexMatch(asArray(asJson(body)['results']), title);
  }
}

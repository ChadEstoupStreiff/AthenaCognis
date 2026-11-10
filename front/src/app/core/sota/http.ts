/** CrossRef works API. */
export const CROSSREF_URL = 'https://api.crossref.org/works';
/** OpenAlex works API. */
export const OPENALEX_URL = 'https://api.openalex.org/works';
/** Same-origin proxy (nginx) to the arXiv API (no CORS upstream). */
export const ARXIV_URL = '/arxiv/api/query';
const REQUEST_TIMEOUT_MS = 15_000;
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
export async function request(
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
export async function getJson(
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
export function doiPath(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/');
}

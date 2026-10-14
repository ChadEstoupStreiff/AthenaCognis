import { Injectable } from '@angular/core';
import { problemFromBackend } from '@domain/contracts';
import { API_PREFIX } from '../api/api-client';
import {
  type FileSearchQuery,
  parseSearchEvent,
  type SearchEvent,
  toBackendSearchParams,
} from '@domain/search';

/**
 * Build the URL of the streaming search.
 *
 * @param query - Search query.
 * @returns Same-origin URL.
 */
function streamUrl(query: FileSearchQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(toBackendSearchParams(query))) {
    params.set(key, String(value));
  }
  return `${API_PREFIX}/files/search/stream?${params.toString()}`;
}

/**
 * Read a failed response as an error message.
 *
 * @param response - Failed response.
 * @returns The message.
 */
async function failureMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return problemFromBackend(response.status, JSON.parse(text)).message;
  } catch {
    return problemFromBackend(response.status, text).message;
  }
}

/** Streaming file search (`/files/search/stream` is NDJSON, read with `fetch`). */
@Injectable({ providedIn: 'root' })
export class SearchApi {
  /**
   * Stream search events.
   *
   * @param query - Search query.
   * @param signal - Abort signal (cancels the request).
   * @yields One event per NDJSON line.
   * @throws Error when the request fails.
   */
  async *stream(query: FileSearchQuery, signal: AbortSignal): AsyncGenerator<SearchEvent> {
    const response = await fetch(streamUrl(query), { signal, credentials: 'same-origin' });
    if (!response.ok || response.body === null) {
      throw new Error(await failureMessage(response));
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer += chunk.value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      yield* lines.map(parseSearchEvent).filter((event): event is SearchEvent => event !== null);
    }
    const last = parseSearchEvent(buffer);
    if (last !== null) {
      yield last;
    }
  }
}

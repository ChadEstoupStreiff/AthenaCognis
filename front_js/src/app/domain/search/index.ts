/** Search depth: 0 quick (names), 1 normal (+ OCR/summary/notes), 2 deep (+ content). */
export type SearchMode = 0 | 1 | 2;

/** Search depth labels. */
export const SEARCH_MODES: readonly {
  readonly value: SearchMode;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 0, label: 'Quick', hint: 'File names only' },
  { value: 1, label: 'Normal', hint: 'Names, notes, OCR, summaries and transcriptions' },
  { value: 2, label: 'Deep', hint: 'Everything, including document contents' },
];

/** A filter list that can be inverted. */
export interface SearchFilter {
  readonly values: readonly string[];
  readonly exclude: boolean;
}

/** File search query (SPA shape). */
export interface FileSearchQuery {
  readonly text: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly mode: SearchMode;
  readonly semantic: boolean;
  readonly similarityThreshold: number;
  readonly folders: SearchFilter;
  readonly mimes: SearchFilter;
  readonly projects: SearchFilter;
  readonly tags: SearchFilter;
}

/** One NDJSON event of `GET /files/search/stream`. */
export type SearchEvent =
  | { readonly type: 'total'; readonly count: number }
  | {
      readonly type: 'progress';
      readonly current: number;
      readonly total: number;
      readonly file: string;
    }
  | { readonly type: 'semantic_searching'; readonly count: number }
  | { readonly type: 'result'; readonly path: string }
  | { readonly type: 'error'; readonly message: string };

/** Backend query parameter value. */
type ParamValue = string | number | boolean;

/**
 * Add a CSV filter and its exclude flag when the filter has values.
 *
 * @param params - Parameters being built.
 * @param name - Backend parameter name.
 * @param excludeName - Backend exclude flag name.
 * @param filter - Filter.
 */
function addFilter(
  params: Record<string, ParamValue>,
  name: string,
  excludeName: string,
  filter: SearchFilter,
): void {
  if (filter.values.length === 0) {
    return;
  }
  params[name] = filter.values.join(',');
  params[excludeName] = filter.exclude;
}

/**
 * Translate a search query into backend query parameters (CSV lists, exclude flags).
 *
 * @param query - SPA query.
 * @returns Parameters for `/files/search` and `/files/search/stream`.
 */
export function toBackendSearchParams(query: FileSearchQuery): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {
    start_date: query.startDate,
    end_date: query.endDate,
    search_mode: query.mode,
    semantic: query.semantic,
    similarity_threshold: query.similarityThreshold,
  };
  const text = query.text.trim();
  if (text !== '') {
    params['text'] = text;
  }
  addFilter(params, 'subfolder', 'exclude_subfolders', query.folders);
  addFilter(params, 'types', 'exclude_file_types', query.mimes);
  addFilter(params, 'projects', 'exclude_projects', query.projects);
  addFilter(params, 'tags', 'exclude_tags', query.tags);
  return params;
}

/**
 * Parse one NDJSON line into a search event.
 *
 * @param line - Raw line.
 * @returns The event, or `null` for blank or malformed lines.
 */
export function parseSearchEvent(line: string): SearchEvent | null {
  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    const value = JSON.parse(trimmed) as { type?: unknown };
    return typeof value.type === 'string' ? (value as SearchEvent) : null;
  } catch {
    return null;
  }
}

import type { Params } from '@angular/router';
import { mimesForCategories } from '@domain/files';
import type { FileSearchQuery, SearchEngine, SearchMode } from '@domain/search';
import { addDays, formatLocalDate } from '@domain/time';

/** Date range presets of the search form. */
export type RangePreset = 'default' | 'today' | '7d' | '30d' | '90d' | '1y' | 'all' | 'custom';

/** Editable state of the search form (serialized in the URL). */
export interface SearchFormState {
  readonly text: string;
  readonly range: RangePreset;
  readonly from: string;
  readonly to: string;
  readonly categories: readonly string[];
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly excludeCategories: boolean;
  readonly excludeProjects: boolean;
  readonly excludeTags: boolean;
  readonly mode: SearchMode;
  readonly engine: SearchEngine;
  readonly exact: boolean;
}

/** Empty form. */
export const EMPTY_SEARCH_FORM: SearchFormState = {
  text: '',
  range: 'default',
  from: '',
  to: '',
  categories: [],
  projects: [],
  tags: [],
  excludeCategories: false,
  excludeProjects: false,
  excludeTags: false,
  mode: 1,
  engine: 'contains',
  exact: false,
};

const PRESET_DAYS: Readonly<Partial<Record<RangePreset, number>>> = {
  today: 0,
  '7d': 6,
  '30d': 29,
  '90d': 89,
  '1y': 364,
};
const ALL_START = '1970-01-01';
const ALL_END = '2999-12-31';
const LIST_SEPARATOR = '|';
const MODES: readonly SearchMode[] = [0, 1, 2];
const ENGINES: readonly SearchEngine[] = ['contains', 'fuzzy', 'semantic'];
const PRESETS: readonly RangePreset[] = [
  'default',
  'today',
  '7d',
  '30d',
  '90d',
  '1y',
  'all',
  'custom',
];

/** Labels of the range presets. */
export const RANGE_LABELS: readonly { readonly value: RangePreset; readonly label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '3 months' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' },
];

/**
 * Resolve the date range of a form.
 *
 * @param state - Form state.
 * @param today - Reference day.
 * @param defaultDays - `search_default_timeframe_days` setting.
 * @returns Start and end dates.
 */
export function resolveRange(
  state: SearchFormState,
  today: Date,
  defaultDays: number,
): { start: string; end: string } {
  const end = formatLocalDate(today);
  if (state.range === 'all') {
    return { start: ALL_START, end: ALL_END };
  }
  if (state.range === 'custom') {
    return {
      start: state.from === '' ? ALL_START : state.from,
      end: state.to === '' ? end : state.to,
    };
  }
  const days = PRESET_DAYS[state.range] ?? defaultDays;
  return { start: formatLocalDate(addDays(today, -days)), end };
}

/** Context needed to turn a form into a query. */
export interface QueryOptions {
  readonly today: Date;
  readonly defaultDays: number;
  readonly threshold: number;
  readonly forcedTags?: readonly string[];
}

/**
 * Build the backend query of a form.
 *
 * @param state - Form state.
 * @param options - Reference day, default range, semantic threshold and forced tags.
 * @returns The query.
 */
export function toSearchQuery(state: SearchFormState, options: QueryOptions): FileSearchQuery {
  const { start, end } = resolveRange(state, options.today, options.defaultDays);
  const forced = options.forcedTags ?? [];
  return {
    text: state.text,
    startDate: start,
    endDate: end,
    mode: state.mode,
    engine: state.engine,
    exact: state.exact && state.engine === 'contains',
    similarityThreshold: options.threshold,
    mimes: { values: mimesForCategories(state.categories), exclude: state.excludeCategories },
    projects: { values: state.projects, exclude: state.excludeProjects },
    tags:
      forced.length > 0
        ? { values: forced, exclude: false }
        : { values: state.tags, exclude: state.excludeTags },
  };
}

/**
 * Split a URL list parameter.
 *
 * @param value - Parameter value.
 * @returns Items.
 */
function listParam(value: unknown): string[] {
  return typeof value === 'string' && value !== '' ? value.split(LIST_SEPARATOR) : [];
}

/**
 * Read the matching engine from URL query parameters (legacy `semantic=1` included).
 *
 * @param params - Query parameters.
 * @returns Engine.
 */
function parseEngine(params: Params): SearchEngine {
  const engine = ENGINES.find((value) => value === params['engine']);
  if (engine !== undefined) {
    return engine;
  }
  return params['semantic'] === '1' ? 'semantic' : EMPTY_SEARCH_FORM.engine;
}

/**
 * Read a form from URL query parameters.
 *
 * @param params - Query parameters.
 * @returns Form state.
 */
export function formFromParams(params: Params): SearchFormState {
  const text = (key: string): string => {
    const value: unknown = params[key];
    return typeof value === 'string' ? value : '';
  };
  const mode = Number(params['mode']);
  return {
    text: text('q'),
    range: PRESETS.find((preset) => preset === params['range']) ?? 'default',
    from: text('from'),
    to: text('to'),
    categories: listParam(params['types']),
    projects: listParam(params['projects']),
    tags: listParam(params['tags']),
    excludeCategories: params['xtypes'] === '1',
    excludeProjects: params['xprojects'] === '1',
    excludeTags: params['xtags'] === '1',
    mode: MODES.find((value) => value === mode) ?? EMPTY_SEARCH_FORM.mode,
    engine: parseEngine(params),
    exact: params['exact'] === '1',
  };
}

/**
 * Write a form as URL query parameters (defaults omitted).
 *
 * @param state - Form state.
 * @returns Query parameters (`null` removes a key).
 */
export function paramsFromForm(state: SearchFormState): Params {
  const list = (values: readonly string[]): string | null =>
    values.length === 0 ? null : values.join(LIST_SEPARATOR);
  const flag = (value: boolean): string | null => (value ? '1' : null);
  return {
    q: state.text === '' ? null : state.text,
    range: state.range === 'default' ? null : state.range,
    from: state.range === 'custom' && state.from !== '' ? state.from : null,
    to: state.range === 'custom' && state.to !== '' ? state.to : null,
    types: list(state.categories),
    projects: list(state.projects),
    tags: list(state.tags),
    xtypes: flag(state.excludeCategories),
    xprojects: flag(state.excludeProjects),
    xtags: flag(state.excludeTags),
    mode: state.mode === EMPTY_SEARCH_FORM.mode ? null : String(state.mode),
    engine: state.engine === EMPTY_SEARCH_FORM.engine ? null : state.engine,
    exact: flag(state.exact),
  };
}

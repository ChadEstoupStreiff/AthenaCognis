import { toBackendSearchParams } from '@domain/search';

import {
  EMPTY_SEARCH_FORM,
  formFromParams,
  paramsFromForm,
  resolveRange,
  toSearchQuery,
} from './search-form';

describe('search form', () => {
  const today = new Date(2026, 9, 14);

  it('resolves presets', () => {
    expect(resolveRange({ ...EMPTY_SEARCH_FORM, range: '7d' }, today, 30)).toEqual({
      start: '2026-10-08',
      end: '2026-10-14',
    });
    expect(resolveRange(EMPTY_SEARCH_FORM, today, 30).start).toBe('2026-09-14');
    expect(resolveRange({ ...EMPTY_SEARCH_FORM, range: 'all' }, today, 30).start).toBe(
      '1970-01-01',
    );
  });

  it('round-trips through URL params', () => {
    const state = {
      ...EMPTY_SEARCH_FORM,
      text: 'mri',
      tags: ['A', 'B c'],
      excludeTags: true,
      exact: true,
      engine: 'fuzzy' as const,
      mode: 2 as const,
      range: '1y' as const,
    };
    const params = Object.fromEntries(
      Object.entries(paramsFromForm(state)).filter(([, value]) => value !== null),
    );
    expect(formFromParams(params)).toEqual(state);
  });

  it('forces tags', () => {
    const query = toSearchQuery(
      { ...EMPTY_SEARCH_FORM, tags: ['x'], categories: ['audio'] },
      { today, defaultDays: 30, threshold: 0.4, forcedTags: ['sota'] },
    );
    expect(query.tags).toEqual({ values: ['sota'], exclude: false });
    expect(query.mimes.values).toContain('audio/mpeg');
  });

  it('passes exact match to the backend only when on', () => {
    const options = { today, defaultDays: 30, threshold: 0.4 };
    const exact = toSearchQuery(
      { ...EMPTY_SEARCH_FORM, text: 'U-Net paper', exact: true },
      options,
    );
    expect(toBackendSearchParams(exact)['exact']).toBe(true);
    const loose = toSearchQuery({ ...EMPTY_SEARCH_FORM, text: 'U-Net paper' }, options);
    expect(toBackendSearchParams(loose)).not.toHaveProperty('exact');
    const fuzzy = toSearchQuery({ ...EMPTY_SEARCH_FORM, exact: true, engine: 'fuzzy' }, options);
    expect(toBackendSearchParams(fuzzy)).not.toHaveProperty('exact');
    expect(toBackendSearchParams(fuzzy)['engine']).toBe('fuzzy');
  });

  it('reads the legacy semantic flag as the semantic engine', () => {
    expect(formFromParams({ semantic: '1' }).engine).toBe('semantic');
    expect(formFromParams({ engine: 'nope' }).engine).toBe('contains');
  });
});

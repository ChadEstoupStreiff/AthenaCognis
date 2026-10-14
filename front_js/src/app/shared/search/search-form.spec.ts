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
});

import { EMPTY_INFO } from './paper';
import { activeFilterCount, applyResultFilters, NO_RESULT_FILTERS } from './result-filters';
import type { SearchHit } from './search';

/**
 * Build a hit.
 *
 * @param key - Key and title.
 * @param extra - Overrides.
 * @returns Hit.
 */
function makeHit(key: string, extra: Partial<SearchHit> = {}): SearchHit {
  return {
    key,
    info: {
      ...EMPTY_INFO,
      title: `${key} graph networks`,
      authors: 'Vaswani, Ashish | Shazeer, Noam',
      journal: 'Nature Medicine',
    },
    abstract: 'Segmentation of tumors.',
    citedBy: 10,
    pdfUrls: [],
    openAccess: false,
    sources: ['openalex'],
    published: '2024',
    reasons: [],
    ...extra,
  };
}

const NONE = new Set<string>();

describe('result filters', () => {
  const hits = [
    makeHit('a'),
    makeHit('b', { citedBy: 2, pdfUrls: ['https://x/y.pdf'], abstract: '' }),
    makeHit('c', {
      citedBy: null,
      info: { ...EMPTY_INFO, title: 'c survey', authors: 'Doe, Jane', journal: 'arXiv' },
    }),
  ];

  /**
   * Keys kept by a filter patch.
   *
   * @param patch - Filters.
   * @param owned - Library keys.
   * @returns Keys.
   */
  function kept(patch: Partial<typeof NO_RESULT_FILTERS>, owned = NONE): string[] {
    return applyResultFilters(hits, { ...NO_RESULT_FILTERS, ...patch }, owned).map(
      (hit) => hit.key,
    );
  }

  it('keeps everything without filters', () => {
    expect(kept({})).toEqual(['a', 'b', 'c']);
    expect(activeFilterCount(NO_RESULT_FILTERS)).toBe(0);
  });

  it('filters by citations, author, venue and words', () => {
    expect(kept({ minCitations: 5 })).toEqual(['a']);
    expect(kept({ author: 'ashish vaswani' })).toEqual(['a', 'b']);
    expect(kept({ author: 'jane d' })).toEqual(['c']);
    expect(kept({ venue: 'nature' })).toEqual(['a', 'b']);
    expect(kept({ include: 'tumors segmentation' })).toEqual(['a', 'c']);
    expect(kept({ include: 'graph tumors' })).toEqual(['a']);
    expect(kept({ exclude: 'survey' })).toEqual(['a', 'b']);
  });

  it('filters by PDF, abstract and library', () => {
    expect(kept({ withPdfOnly: true })).toEqual(['b']);
    expect(kept({ withAbstractOnly: true })).toEqual(['a', 'c']);
    expect(kept({ hideInLibrary: true }, new Set(['a']))).toEqual(['b', 'c']);
    expect(activeFilterCount({ ...NO_RESULT_FILTERS, author: 'x', withPdfOnly: true })).toBe(2);
  });
});

import { EMPTY_INFO, type Paper } from './paper';
import {
  combineHits,
  crossrefToHit,
  filterHits,
  findInLibrary,
  hitFileName,
  openalexToHit,
  parseArxivHits,
  parseIdentifier,
  rebuildAbstract,
  type SearchHit,
  type SearchQuery,
  sortHits,
} from './search';

const OPENALEX_WORK = {
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.48550/arXiv.1706.03762',
  display_name: 'Attention Is All You Need',
  publication_year: 2017,
  cited_by_count: 100000,
  authorships: [
    { author: { display_name: 'Ashish Vaswani' } },
    { author: { display_name: 'Noam Shazeer' } },
  ],
  primary_location: { source: { display_name: 'arXiv' }, pdf_url: null, landing_page_url: 'x' },
  best_oa_location: { pdf_url: 'https://arxiv.org/pdf/1706.03762v7' },
  locations: [],
  open_access: { is_oa: true, oa_url: 'https://arxiv.org/abs/1706.03762' },
  biblio: { volume: '30', first_page: '5998', last_page: '6008' },
  abstract_inverted_index: { The: [0], dominant: [1], models: [2, 4], are: [3] },
};

const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
      You Need</title>
    <summary>  The dominant sequence transduction models.  </summary>
    <author><name>Ashish Vaswani</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

const CROSSREF_ITEM = {
  DOI: '10.1000/xyz',
  title: ['Deep Residual Learning'],
  author: [{ family: 'He', given: 'Kaiming' }],
  issued: { 'date-parts': [[2016]] },
  'container-title': ['CVPR'],
  'is-referenced-by-count': 5000,
  abstract: '<jats:p>Abstract. Deeper networks are hard.</jats:p>',
  link: [
    { URL: 'https://pub.example/x.pdf', 'content-type': 'application/pdf' },
    { URL: 'https://pub.example/x.xml', 'content-type': 'text/xml' },
  ],
};

const QUERY: SearchQuery = {
  text: 'attention',
  sources: ['openalex', 'arxiv'],
  yearFrom: null,
  yearTo: null,
  withPdfOnly: false,
  page: 1,
};

/**
 * Build a minimal hit.
 *
 * @param title - Title.
 * @param extra - Overrides.
 * @returns Hit.
 */
function makeHit(title: string, extra: Partial<SearchHit> = {}): SearchHit {
  return {
    key: `title:${title}`,
    info: { ...EMPTY_INFO, title, year: '2020' },
    abstract: '',
    citedBy: null,
    pdfUrls: [],
    openAccess: false,
    sources: ['crossref'],
    published: '2020',
    reasons: [],
    ...extra,
  };
}

describe('paper search', () => {
  it('recognizes DOIs and arXiv ids', () => {
    expect(parseIdentifier('10.1038/nature14539')).toEqual({
      kind: 'doi',
      value: '10.1038/nature14539',
    });
    expect(parseIdentifier('https://doi.org/10.1038/nature14539.')).toEqual({
      kind: 'doi',
      value: '10.1038/nature14539',
    });
    expect(parseIdentifier('arXiv:1706.03762v5')).toEqual({ kind: 'arxiv', value: '1706.03762' });
    expect(parseIdentifier('https://arxiv.org/abs/2101.00001')).toEqual({
      kind: 'arxiv',
      value: '2101.00001',
    });
    expect(parseIdentifier('graph neural networks')).toBeNull();
  });

  it('rebuilds OpenAlex abstracts', () => {
    expect(rebuildAbstract({ b: [1], a: [0, 2] })).toBe('a b a');
    expect(rebuildAbstract(null)).toBe('');
  });

  it('converts an OpenAlex work', () => {
    const hit = openalexToHit(OPENALEX_WORK);
    expect(hit.key).toBe('arxiv:1706.03762');
    expect(hit.info.authors).toBe('Vaswani, Ashish | Shazeer, Noam');
    expect(hit.info.doi).toBe('10.48550/arXiv.1706.03762');
    expect(hit.info.pages).toBe('5998-6008');
    expect(hit.abstract).toBe('The dominant models are models');
    expect(hit.citedBy).toBe(100000);
    expect(hit.openAccess).toBe(true);
    expect(hit.published).toBe('2017');
    expect(hit.pdfUrls[0]).toBe('https://arxiv.org/pdf/1706.03762v7');
    expect(hit.pdfUrls).toContain('https://arxiv.org/pdf/1706.03762');
  });

  it('converts arXiv entries', () => {
    const [hit] = parseArxivHits(ARXIV_FEED);
    expect(hit?.key).toBe('arxiv:1706.03762');
    expect(hit?.info.title).toBe('Attention Is All You Need');
    expect(hit?.info.url).toBe('https://arxiv.org/abs/1706.03762');
    expect(hit?.abstract).toBe('The dominant sequence transduction models.');
    expect(hit?.pdfUrls[0]).toBe('http://arxiv.org/pdf/1706.03762v7');
    expect(hit?.published).toBe('2017-06-12');
  });

  it('converts CrossRef items', () => {
    const hit = crossrefToHit(CROSSREF_ITEM);
    expect(hit.key).toBe('doi:10.1000/xyz');
    expect(hit.abstract).toBe('Deeper networks are hard.');
    expect(hit.citedBy).toBe(5000);
    expect(hit.pdfUrls).toEqual(['https://pub.example/x.pdf']);
  });

  it('interleaves sources and merges duplicates', () => {
    const openalex = openalexToHit(OPENALEX_WORK);
    const arxiv = parseArxivHits(ARXIV_FEED);
    const other = makeHit('Other paper');
    const combined = combineHits([[openalex, other], arxiv]);
    expect(combined.map((hit) => hit.info.title)).toEqual([
      'Attention Is All You Need',
      'Other paper',
    ]);
    expect(combined[0]?.sources).toEqual(['openalex', 'arxiv']);
    expect(combined[0]?.citedBy).toBe(100000);
    expect(combineHits([[makeHit('Other paper', { citedBy: 3 })]], combined)).toHaveLength(2);
  });

  it('filters by year and PDF availability', () => {
    const old = makeHit('Old', { info: { ...EMPTY_INFO, title: 'Old', year: '1999' } });
    const recent = makeHit('Recent', { pdfUrls: ['https://x/y.pdf'] });
    expect(filterHits([old, recent], { ...QUERY, yearFrom: 2000 })).toEqual([recent]);
    expect(filterHits([old, recent], { ...QUERY, withPdfOnly: true })).toEqual([recent]);
  });

  it('sorts by citations, date, title and PDF availability', () => {
    const cited = makeHit('B', { citedBy: 10 });
    const fresh = makeHit('C', { published: '2024-05-02' });
    const withPdf = makeHit('A', { published: '', pdfUrls: ['https://x/y.pdf'] });
    const hits = [fresh, cited, withPdf];
    expect(sortHits(hits, 'relevance')).toEqual(hits);
    expect(sortHits(hits, 'citations')[0]).toBe(cited);
    expect(sortHits(hits, 'newest')[0]).toBe(fresh);
    expect(sortHits(hits, 'oldest').map((hit) => hit.info.title)).toEqual(['B', 'C', 'A']);
    expect(sortHits(hits, 'title')[0]).toBe(withPdf);
    expect(sortHits(hits, 'pdf')[0]).toBe(withPdf);
  });

  it('finds hits already in the library', () => {
    const paper: Paper = {
      path: '/shared/2025-01-01/uploads/a.pdf',
      info: { ...EMPTY_INFO, title: 'Attention is all you need', year: '2017' },
    };
    expect(findInLibrary(openalexToHit(OPENALEX_WORK), [paper])).toBe(paper);
    expect(findInLibrary(makeHit('Unrelated'), [paper])).toBeNull();
  });

  it('builds safe file names', () => {
    expect(hitFileName(openalexToHit(OPENALEX_WORK).info)).toBe(
      'vaswani_2017_attention-is-all-you-need.pdf',
    );
    expect(hitFileName(EMPTY_INFO)).toBe('paper.pdf');
  });
});

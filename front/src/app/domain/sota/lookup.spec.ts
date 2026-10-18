import { lookupPaper, type LookupSources, mergeInfo } from './lookup';
import { EMPTY_INFO, type PaperInfo } from './paper';
import { parseTeiHeader } from './tei';
import { titlesMatch } from './text';

const TEI_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title level="a" type="main">Attention Is All You Need</title></titleStmt>
      <publicationStmt><date type="published" when="2017-12-04">2017</date></publicationStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author><persName><forename type="first">Ashish</forename><surname>Vaswani</surname></persName></author>
            <author><persName><forename type="first">Noam</forename><forename type="middle">M</forename><surname>Shazeer</surname></persName></author>
            <author><affiliation>Google Brain</affiliation></author>
            <title level="a" type="main">Attention Is All You Need</title>
          </analytic>
          <monogr>
            <title level="j">Advances in Neural Information Processing Systems</title>
            <imprint>
              <biblScope unit="volume">30</biblScope>
              <biblScope unit="page" from="5998" to="6008"/>
              <date type="published" when="2017"/>
            </imprint>
          </monogr>
          <idno type="DOI">10.5555/3295222.3295349</idno>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
</TEI>`;

const PDF_PATH = '/shared/2025-01-02/uploads/1706.03762v7.pdf';

/**
 * Metadata with some fields.
 *
 * @param fields - Fields.
 * @returns Metadata.
 */
function info(fields: Partial<PaperInfo>): PaperInfo {
  return { ...EMPTY_INFO, ...fields };
}

/**
 * Stub sources (port of `stub_lookup`).
 *
 * @param grobid - GROBID result (null = GROBID down).
 * @param byDoi - CrossRef DOI result.
 * @param byTitle - Candidates of every title search.
 * @returns Sources and recorded title queries.
 */
function stub(
  grobid: PaperInfo | null,
  byDoi: PaperInfo | null,
  byTitle: PaperInfo[],
): { sources: LookupSources; queries: string[] } {
  const queries: string[] = [];
  const sources: LookupSources = {
    grobidHeader: () =>
      grobid === null ? Promise.reject(new Error('grobid down')) : Promise.resolve(grobid),
    crossrefByDoi: () => Promise.resolve(byDoi),
    titleSearchers: [
      (title) => {
        queries.push(title);
        return Promise.resolve(byTitle);
      },
    ],
  };
  return { sources, queries };
}

describe('reference lookup (port of test_reference_lookup.py)', () => {
  it('parses a GROBID TEI header', () => {
    const parsed = parseTeiHeader(TEI_HEADER);
    expect(parsed.title).toBe('Attention Is All You Need');
    expect(parsed.authors).toBe('Vaswani, Ashish | Shazeer, Noam M');
    expect(parsed.year).toBe('2017');
    expect(parsed.journal).toBe('Advances in Neural Information Processing Systems');
    expect([parsed.volume, parsed.pages]).toEqual(['30', '5998-6008']);
    expect(parsed.url).toBe('https://doi.org/10.5555/3295222.3295349');
  });

  it('matches title variants and rejects other papers', () => {
    expect(titlesMatch('Attention is all you need.', 'ATTENTION IS ALL YOU NEED')).toBe(true);
    expect(titlesMatch('Réseaux de neurones', 'Reseaux de neurones')).toBe(true);
    expect(
      titlesMatch(
        'Attention is not all you need: pure attention loses rank',
        'Attention is all you need',
      ),
    ).toBe(false);
    expect(titlesMatch('', 'Anything')).toBe(false);
    const long =
      'A comprehensive survey of deep learning methods for medical image segmentation tasks';
    expect(titlesMatch(long.replace('segmentation', 'segmentatlon'), long)).toBe(true);
  });

  it('merges non-empty fields and keeps base flags', () => {
    const merged = mergeInfo(
      info({ title: 'Old', url: 'https://keep.me', validated: true, source: 'manual' }),
      info({ title: 'New', source: 'crossref' }),
    );
    expect([merged.title, merged.url, merged.validated, merged.source]).toEqual([
      'New',
      'https://keep.me',
      true,
      'manual',
    ]);
  });

  it('prefers the CrossRef DOI record and skips title search', async () => {
    const extracted = info({ title: 'Attention Is All You Need', doi: '10.1/x', journal: 'NIPS' });
    const crossref = info({
      title: 'Attention is all you need',
      doi: '10.1/x',
      journal: 'NeurIPS',
      source: 'crossref',
    });
    const { sources, queries } = stub(extracted, crossref, []);
    const result = await lookupPaper({ path: PDF_PATH, info: info({ validated: true }) }, sources);
    expect([result?.info.journal, result?.info.source, result?.info.validated]).toEqual([
      'NeurIPS',
      'grobid + crossref',
      false,
    ]);
    expect(queries).toEqual([]);
  });

  it('searches with the GROBID title and rejects mismatching candidates', async () => {
    const { sources, queries } = stub(info({ title: 'Attention Is All You Need' }), null, [
      info({ title: 'Attention is not all you need', source: 'crossref' }),
    ]);
    const result = await lookupPaper({ path: PDF_PATH, info: EMPTY_INFO }, sources);
    expect(queries).toEqual(['Attention Is All You Need']);
    expect([result?.info.title, result?.info.source]).toEqual([
      'Attention Is All You Need',
      'grobid',
    ]);
  });

  it('falls back to the file name when GROBID is down', async () => {
    const { sources, queries } = stub(null, null, [info({ title: 'Unrelated' })]);
    expect(await lookupPaper({ path: PDF_PATH, info: EMPTY_INFO }, sources)).toBeNull();
    expect(queries).toEqual(['1706.03762v7']);
  });
});

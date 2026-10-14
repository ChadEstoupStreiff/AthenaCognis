import {
  analyzePaper,
  type CitationRecord,
  citationEdges,
  citationRecordFromDict,
  type CitationSources,
  neighborhood,
  parseTeiReferences,
  sharedReferences,
  titleKey,
} from './citations';
import { displayTitle, EMPTY_INFO, type Paper } from './paper';

const TEI_REFERENCES = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><back><div><listBibl>
  <biblStruct><analytic><title level="a">Deep Residual Learning for Image Recognition</title></analytic>
    <monogr><title level="m">CVPR</title></monogr></biblStruct>
  <biblStruct><analytic><title level="a">Sharing data</title><idno type="DOI">10.1371/Journal.PONE.0000308</idno></analytic></biblStruct>
  <biblStruct><monogr><title level="m">Pattern Recognition and Machine Learning</title></monogr></biblStruct>
</listBibl></div></back></text></TEI>`;

const ATTENTION: Paper = {
  path: '/shared/2025-01-01/uploads/attention.pdf',
  info: { ...EMPTY_INFO, title: 'Attention Is All You Need', doi: '10.1/att' },
};
const RESNET: Paper = {
  path: '/shared/2025-01-01/uploads/resnet.pdf',
  info: { ...EMPTY_INFO, title: 'Deep Residual Learning for Image Recognition' },
};
const SHARING: Paper = {
  path: '/shared/2025-01-01/uploads/sharing.pdf',
  info: { ...EMPTY_INFO, title: 'Sharing data', doi: '10.1371/journal.pone.0000308' },
};

/**
 * Record.
 *
 * @param openalexId - OpenAlex id.
 * @param references - References.
 * @param citedBy - Cited-by count.
 * @param source - Source.
 * @returns Record.
 */
function record(
  openalexId: string,
  references: string[],
  citedBy = 0,
  source = '',
): CitationRecord {
  return { openalex_id: openalexId, references, cited_by_count: citedBy, source };
}

/**
 * Stub sources (port of `stub_sources`).
 *
 * @param openalex - OpenAlex result.
 * @param grobid - GROBID references (null = down).
 * @returns Sources.
 */
function stub(openalex: CitationRecord | null, grobid: string[] | null): CitationSources {
  return {
    openalexByDoi: () => Promise.resolve(openalex),
    openalexByTitle: () => Promise.resolve(openalex),
    grobidReferences: () =>
      grobid === null ? Promise.reject(new Error('down')) : Promise.resolve(grobid),
  };
}

describe('citations (port of test_citations.py)', () => {
  it('turns a GROBID bibliography into lowercase DOI keys or title keys', () => {
    expect(parseTeiReferences(TEI_REFERENCES)).toEqual([
      't:deep residual learning for image recognition',
      'doi:10.1371/journal.pone.0000308',
      't:pattern recognition and machine learning',
    ]);
  });

  it('resolves every key kind and counts external works', () => {
    const records = new Map([
      [ATTENTION.path, record('W1', ['W2', 'W99', 'W98', 'W1'], 0, 'openalex')],
      [RESNET.path, record('W2', ['W99'], 0, 'openalex')],
      [
        SHARING.path,
        record('', [titleKey(displayTitle(RESNET)), 'doi:10.1/att', 't:unknown'], 0, 'grobid'),
      ],
    ]);
    const { edges, external } = citationEdges([ATTENTION, RESNET, SHARING], records);
    expect(new Set(edges.map((edge) => `${edge.citing}>${edge.cited}`))).toEqual(
      new Set([
        `${ATTENTION.path}>${RESNET.path}`,
        `${SHARING.path}>${RESNET.path}`,
        `${SHARING.path}>${ATTENTION.path}`,
      ]),
    );
    expect(Object.fromEntries(external)).toEqual({ W99: 2, W98: 1 });
    expect(Object.fromEntries(sharedReferences(external, 2, 10))).toEqual({ W99: 2 });
  });

  it('parses a stored record with missing fields', () => {
    expect(citationRecordFromDict({ openalex_id: 'W1', references: ['W2'] })).toEqual(
      record('W1', ['W2']),
    );
  });

  it('prefers OpenAlex references', async () => {
    expect(
      (await analyzePaper(ATTENTION, stub(record('W1', ['W2'], 5, 'openalex'), ['t:x'])))
        .references,
    ).toEqual(['W2']);
  });

  it('falls back to GROBID and keeps the OpenAlex id', async () => {
    const result = await analyzePaper(ATTENTION, stub(record('W1', [], 5, 'openalex'), ['t:x']));
    expect([result.openalex_id, result.references, result.source]).toEqual([
      'W1',
      ['t:x'],
      'grobid',
    ]);
  });

  it('returns an empty record marked "none" when every source fails', async () => {
    expect(await analyzePaper(ATTENTION, stub(null, null))).toEqual(record('', [], 0, 'none'));
  });

  it('reaches neighbors hop by hop in both directions', () => {
    const pairs = [
      ['a', 'b'],
      ['c', 'b'],
      ['c', 'd'],
      ['x', 'y'],
    ] as const;
    expect(neighborhood(pairs, 'a', 1)).toEqual(new Set(['a', 'b']));
    expect(neighborhood(pairs, 'a', 2)).toEqual(new Set(['a', 'b', 'c']));
    expect(neighborhood(pairs, 'a', 3)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(neighborhood(pairs, 'lonely', 2)).toEqual(new Set(['lonely']));
  });
});

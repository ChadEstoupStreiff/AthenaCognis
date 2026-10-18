import { buildZip, collectSources, parseSources } from './archive';
import {
  type BibEntry,
  bibtexCitations,
  parseBibtex,
  parseRis,
  planImport,
  toBibtex,
  toRis,
} from './bibliography';
import { EMPTY_INFO, type Paper, type PaperInfo, paperInfoToDict } from './paper';

const ZOTERO_BIBTEX = String.raw`
@article{vaswani_attention_2017,
  title = {Attention Is {All} You Need},
  author = {Vaswani, Ashish and Noam Shazeer},
  journal = {Advances in Neural Information Processing Systems},
  volume = {30},
  pages = {5998--6008},
  year = {2017},
  file = {Full Text PDF:files/12/Vaswani et al. - 2017 - Attention.pdf:application/pdf},
}
@inproceedings{he_2016,
  title = {Deep Residual Learning for Image Recognition},
  author = {He, Kaiming},
  booktitle = {CVPR},
  date = {2016-06},
  doi = {10.1109/CVPR.2016.90},
}
`;

const ZOTERO_RIS = `TY  - JOUR
TI  - Sharing Detailed Research Data Is Associated with Increased Citation Rate
AU  - Piwowar, Heather A.
AU  - Day, Roger S.
T2  - PLoS ONE
PY  - 2007/03/21/
VL  - 2
IS  - 3
SP  - e308
DO  - 10.1371/journal.pone.0000308
L1  - files/7/Piwowar - 2007 - Sharing.pdf
ER  - 
`;

const INFO: PaperInfo = {
  ...EMPTY_INFO,
  title: 'Attention Is All You Need',
  authors: 'Vaswani, Ashish | Shazeer, Noam',
  year: '2017',
  journal: 'NeurIPS',
  volume: '30',
  pages: '5998-6008',
  doi: '10.1/x',
  url: 'https://doi.org/10.1/x',
};

/**
 * Metadata without its source.
 *
 * @param info - Metadata.
 * @returns Dict without `source`.
 */
function withoutSource(info: PaperInfo): Record<string, string | boolean> {
  return Object.fromEntries(
    Object.entries(paperInfoToDict(info)).filter(([key]) => key !== 'source'),
  );
}

describe('bibliography (port of test_bibliography.py)', () => {
  it('reads a Zotero BibTeX export', () => {
    const [attention, resnet] = parseBibtex(ZOTERO_BIBTEX) as [BibEntry, BibEntry];
    expect(attention.info.title).toBe('Attention Is All You Need');
    expect(attention.info.authors).toBe('Vaswani, Ashish | Shazeer, Noam');
    expect(attention.info.pages).toBe('5998-6008');
    expect(attention.attachment).toBe('Vaswani et al. - 2017 - Attention.pdf');
    expect([resnet.info.journal, resnet.info.year]).toEqual(['CVPR', '2016']);
    expect(resnet.info.url).toBe('https://doi.org/10.1109/CVPR.2016.90');
  });

  it('reads a Zotero RIS export with a BOM', () => {
    const [entry] = parseRis(`\uFEFF${ZOTERO_RIS}`) as [BibEntry];
    expect(entry.info.authors).toBe('Piwowar, Heather A. | Day, Roger S.');
    expect([entry.info.year, entry.info.issue, entry.info.pages]).toEqual(['2007', '3', 'e308']);
    expect(entry.attachment).toBe('Piwowar - 2007 - Sharing.pdf');
  });

  it('round-trips RIS', () => {
    const [entry] = parseRis(toRis([{ info: INFO, attachment: 'a.pdf' }])) as [BibEntry];
    expect(entry.attachment).toBe('a.pdf');
    expect(withoutSource(entry.info)).toEqual(withoutSource(INFO));
  });

  it('round-trips BibTeX with unique keys', () => {
    const text = toBibtex([
      { info: INFO, attachment: 'a.pdf' },
      { info: INFO, attachment: '' },
    ]);
    expect(text).toContain('@article{Vaswani2017Attention,');
    expect(text).toContain('@article{Vaswani2017Attentiona,');
    const [first] = parseBibtex(text) as [BibEntry];
    expect([first.info.title, first.info.authors, first.info.pages]).toEqual([
      INFO.title,
      INFO.authors,
      INFO.pages,
    ]);
    expect(first.attachment).toBe('a.pdf');
  });

  it('formats empty references (regression)', () => {
    expect(bibtexCitations([EMPTY_INFO]).startsWith('@article{ref,')).toBe(true);
  });

  it('collects sources from a zipped Zotero export', () => {
    const archive = buildZip(
      'export.ris',
      ZOTERO_RIS,
      new Map([['Piwowar - 2007 - Sharing.pdf', new TextEncoder().encode('%PDF')]]),
    );
    const sources = collectSources([
      { name: 'export.zip', bytes: archive },
      { name: 'extra.bib', bytes: new TextEncoder().encode(ZOTERO_BIBTEX) },
    ]);
    expect([...sources.pdfs.keys()]).toEqual(['Piwowar - 2007 - Sharing.pdf']);
    expect(parseSources(sources)).toHaveLength(3);
  });

  it('plans the import', () => {
    const byDoi: Paper = {
      path: '/shared/2025-01-01/uploads/x.pdf',
      info: { ...EMPTY_INFO, doi: '10.1109/cvpr.2016.90' },
    };
    const byName: Paper = {
      path: '/shared/2025-01-01/uploads/Attention is all you need.pdf',
      info: EMPTY_INFO,
    };
    const entries = [
      ...parseBibtex(ZOTERO_BIBTEX),
      ...parseRis(ZOTERO_RIS),
      { info: { ...EMPTY_INFO, title: 'Unknown paper' }, attachment: '' },
    ];
    const plan = planImport(entries, [byDoi, byName], new Set(['Piwowar - 2007 - Sharing.pdf']));
    expect(plan.map((item) => item.action)).toEqual(['update', 'update', 'add', 'skip']);
    expect([plan[0]?.existing, plan[1]?.existing]).toEqual([byName, byDoi]);
  });
});

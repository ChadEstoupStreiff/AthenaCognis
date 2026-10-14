import { filterPapers, sortPapers } from './library';
import {
  displayTitle,
  infoKey,
  type Paper,
  paperFileName,
  paperInfoFromDict,
  paperInfoToDict,
  paperStatus,
  paperUploadDate,
  shortAuthors,
} from './paper';

const PATH = '/shared/2025-01-02/uploads/attention.pdf';

/**
 * Build a paper (port of `make_paper`).
 *
 * @param path - Path.
 * @param info - Metadata fields.
 * @returns Paper.
 */
function makePaper(path = PATH, info: Record<string, unknown> = {}): Paper {
  return { path, info: paperInfoFromDict(info) };
}

describe('state of the art (port of test_stateoftheart.py)', () => {
  it('derives file name, date, stockpile key and fallback title from the path', () => {
    const paper = makePaper();
    expect(paperFileName(paper)).toBe('attention.pdf');
    expect(paperUploadDate(paper)).toBe('2025-01-02');
    expect(infoKey(paper)).toBe('sota_info_2025-01-02_attention.pdf');
    expect(displayTitle(paper)).toBe('attention');
  });

  it('ignores unknown keys and casts values', () => {
    const info = paperInfoFromDict({
      select: true,
      Filename: 'x',
      year: 2021,
      validated: 1,
      doi: null,
    });
    expect(info.year).toBe('2021');
    expect(info.validated).toBe(true);
    expect(info.doi).toBe('');
    expect(typeof paperInfoToDict(info)['validated']).toBe('boolean');
    expect(Object.keys(paperInfoToDict(info))).toEqual([
      'title',
      'authors',
      'year',
      'journal',
      'url',
      'doi',
      'volume',
      'issue',
      'pages',
      'source',
      'validated',
    ]);
  });

  it('classifies status', () => {
    expect(paperStatus(makePaper())).toBe('Missing info');
    expect(paperStatus(makePaper(PATH, { title: 'T', authors: 'Doe, J' }))).toBe('To review');
    expect(paperStatus(makePaper(PATH, { validated: true }))).toBe('Validated');
  });

  it('filters and sorts', () => {
    const old = makePaper('/shared/2025-01-01/uploads/a.pdf', {
      title: 'Old work',
      authors: 'Doe, J',
      year: '1999',
    });
    const recent = makePaper('/shared/2025-01-03/uploads/b.pdf', {
      title: 'New work',
      authors: 'Roe, A',
      year: '2024',
    });
    const papers = [old, recent];
    expect(filterPapers(papers, 'All', 'roe')).toEqual([recent]);
    expect(filterPapers(papers, 'Validated', '')).toEqual([]);
    expect(sortPapers(papers, 'Newest first')).toEqual([recent, old]);
    expect(sortPapers(papers, 'Oldest first')).toEqual([old, recent]);
  });

  it('shortens authors', () => {
    expect(shortAuthors('Doe, John | Roe, Ann')).toBe('Doe, Roe');
    expect(shortAuthors('A, a | B, b | C, c | D, d')).toBe('A, B, C et al.');
    expect(shortAuthors('')).toBe('');
  });
});

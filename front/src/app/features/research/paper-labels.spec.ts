import { EMPTY_INFO, type Paper } from '@domain/sota';
import { paperDetails } from './paper-labels';

describe('paper labels', () => {
  it('joins authors, year and journal, skipping blanks', () => {
    const paper: Paper = {
      path: '/shared/2026-01-02/papers/a.pdf',
      info: { ...EMPTY_INFO, authors: 'Doe, John | Smith, Ann', year: ' 2024 ', journal: '' },
    };
    expect(paperDetails(paper)).toBe('Doe, Smith · 2024');
  });

  it('returns an empty line without reference information', () => {
    expect(paperDetails({ path: '/shared/2026-01-02/papers/a.pdf', info: EMPTY_INFO })).toBe('');
  });
});

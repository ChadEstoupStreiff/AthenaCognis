import { type AiLink, aiGraphLinks } from './relation-map';

const PATHS = new Set(['a.pdf', 'b.pdf', 'c.pdf']);
const LINKS: AiLink[] = [
  { fileA: 'a.pdf', fileB: 'b.pdf', force: 1.5, comment: 'weak' },
  { fileA: 'b.pdf', fileB: 'c.pdf', force: 3, comment: 'strong' },
  { fileA: 'c.pdf', fileB: 'b.pdf', force: 3, comment: 'duplicate' },
  { fileA: 'a.pdf', fileB: 'z.pdf', force: 3, comment: 'outside library' },
];

describe('aiGraphLinks', () => {
  it('keeps every library link by default, deduplicated', () => {
    expect(aiGraphLinks(LINKS, PATHS).map((link) => link.comment)).toEqual(['weak', 'strong']);
  });

  it('drops links weaker than the minimum strength', () => {
    expect(aiGraphLinks(LINKS, PATHS, 3).map((link) => link.comment)).toEqual(['strong']);
  });
});

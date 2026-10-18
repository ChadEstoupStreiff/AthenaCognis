import { latexToUnicode, parseBibtexRecords } from './bibtex';

describe('BibTeX reader', () => {
  it('reads entries, macros, concatenation and nested braces', () => {
    const records = parseBibtexRecords(`
      @string{nips = "Advances in Neural " # "Information Processing"}
      @comment{ignored {stuff}}
      @Article{key1,
        Title = {Attention Is {All} You Need},
        journal = nips # { Systems},
        month = jun,
        year = 2017,
      }
      @book(key2, title = "The {"}quoted{"} book")
    `);
    expect(records).toEqual([
      {
        title: 'Attention Is All You Need',
        journal: 'Advances in Neural Information Processing Systems',
        month: 'June',
        year: '2017',
        ENTRYTYPE: 'article',
        ID: 'key1',
      },
      { title: 'The "quoted" book', ENTRYTYPE: 'book', ID: 'key2' },
    ]);
  });

  it('converts LaTeX accents and symbols', () => {
    expect(latexToUnicode("R{\\'e}seaux de neurones")).toBe('Réseaux de neurones');
    expect(latexToUnicode('M\\"{u}ller and \\v{C}ech, \\ss{} \\& \\o')).toBe(
      'Müller and Čech, ß & ø',
    );
    expect(latexToUnicode('\\textit{Deep} learning~methods')).toBe('Deep learning methods');
    expect(latexToUnicode('100\\% \\{kept\\}')).toBe('100% {kept}');
    expect(latexToUnicode('5998--6008')).toBe('5998--6008');
  });
});

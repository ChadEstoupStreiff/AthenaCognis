import { partRows, promptStatItems } from './dry-run-stats';

const STATS = { characters: 4000, words: 600, lines: 40, estimated_tokens: 1000 };

describe('promptStatItems', () => {
  it('lists the prompt size without context share when the window is unknown', () => {
    expect(promptStatItems(STATS, 0).map((item) => item.label)).toEqual([
      'Characters',
      'Words',
      'Lines',
      'Tokens',
    ]);
  });

  it('adds the context share and flags a nearly full window', () => {
    const roomy = promptStatItems(STATS, 8000).at(-1);
    expect(roomy).toMatchObject({ label: 'Context', isWarning: false });
    expect(roomy?.value).toContain('12.5%');
    expect(promptStatItems(STATS, 1100).at(-1)?.isWarning).toBe(true);
  });
});

describe('partRows', () => {
  const size = (tokens: number): typeof STATS => ({ ...STATS, estimated_tokens: tokens });

  it('gives each block its share and activities only for sources', () => {
    const rows = partRows(
      [
        { label: 'Instructions', kind: 'instructions', activities: 0, error: '', stats: size(250) },
        { label: 'GitHub', kind: 'source', activities: 3, error: '', stats: size(750) },
      ],
      1000,
    );
    expect(rows.map((row) => [row.label, row.activities, row.share])).toEqual([
      ['Instructions', null, 25],
      ['GitHub', 3, 75],
    ]);
    expect(rows[1]?.tokens).toBe('~750');
  });

  it('gives no share to an empty prompt', () => {
    const rows = partRows(
      [{ label: 'GitHub', kind: 'source', activities: 0, error: 'down', stats: size(0) }],
      0,
    );
    expect(rows[0]?.share).toBe(0);
  });
});

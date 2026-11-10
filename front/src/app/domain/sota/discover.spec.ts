import {
  aiPaperContext,
  aiQueryHits,
  defaultDiscoverRequest,
  discoverRange,
  isTextScope,
  MAX_AI_SEED_PAPERS,
  parseCandidate,
  parseSeedWork,
  periodStart,
  rankDiscoveries,
  seedPapers,
  subjectHits,
  topTopics,
} from './discover';
import { EMPTY_INFO, type Paper } from './paper';

const NOW = new Date('2026-11-10T12:00:00Z');

/**
 * Build a library paper.
 *
 * @param date - Upload date folder.
 * @param title - Title.
 * @returns Paper.
 */
function makePaper(date: string, title: string): Paper {
  return { path: `/shared/${date}/uploads/${title}.pdf`, info: { ...EMPTY_INFO, title } };
}

/**
 * Build a raw OpenAlex work.
 *
 * @param id - Short id.
 * @param title - Title.
 * @param references - Referenced short ids.
 * @param topics - Topic short ids.
 * @returns Work.
 */
function makeWork(id: string, title: string, references: string[], topics: string[]): unknown {
  return {
    id: `https://openalex.org/${id}`,
    doi: `https://doi.org/10.1/${id}`,
    display_name: title,
    publication_year: 2026,
    publication_date: '2026-11-01',
    cited_by_count: 1,
    referenced_works: references.map((ref) => `https://openalex.org/${ref}`),
    topics: topics.map((topic) => ({ id: `https://openalex.org/${topic}`, display_name: topic })),
  };
}

describe('discovery of related papers', () => {
  it('seeds with the whole library or the papers added in the last 30 days', () => {
    const old = makePaper('2026-08-01', 'old');
    const recent = makePaper('2026-11-01', 'recent');
    expect(seedPapers([old, recent], 'library', NOW)).toEqual([old, recent]);
    expect(seedPapers([old, recent], 'recent', NOW)).toEqual([recent]);
  });

  it('computes the start of the period', () => {
    expect(periodStart(1, NOW)).toBe('2026-10-10');
    expect(periodStart(12, NOW)).toBe('2025-11-10');
    expect(periodStart(0, NOW)).toBe('2026-11-10');
  });

  it('ranks the library topics by frequency', () => {
    const seeds = [
      parseSeedWork(makeWork('W1', 'a', [], ['T1', 'T2'])),
      parseSeedWork(makeWork('W2', 'b', [], ['T2'])),
    ];
    expect(topTopics(seeds, 1)).toEqual([{ id: 'T2', name: 'T2', count: 2 }]);
  });

  it('scores citing works above topic matches and drops library papers', () => {
    const seeds = [parseSeedWork(makeWork('W1', 'Seed paper', [], ['T1']))];
    const topics = topTopics(seeds, 5);
    const citing = parseCandidate(makeWork('W10', 'Citing work', ['W1'], []));
    const onTopic = parseCandidate(makeWork('W11', 'On topic work', [], ['T1']));
    const unrelated = parseCandidate(makeWork('W12', 'Unrelated work', [], ['T9']));
    const owned = parseCandidate(makeWork('W13', 'Owned work', ['W1'], ['T1']));
    const library = [makePaper('2026-01-01', 'x')].map((paper) => ({
      ...paper,
      info: { ...paper.info, title: 'Owned work' },
    }));
    const ranked = rankDiscoveries([onTopic, unrelated, citing, owned], seeds, topics, library);
    expect(ranked.map((hit) => hit.info.title)).toEqual(['Citing work', 'On topic work']);
    expect(ranked[0]?.reasons).toEqual(['Cites 1 of your paper']);
    expect(ranked[1]?.reasons).toEqual(['Topic: T1']);
  });

  it('computes preset and custom publication ranges', () => {
    const base = { scope: 'library' as const, from: null, to: null, custom: '' };
    expect(discoverRange({ ...base, period: 3 }, NOW)).toEqual({
      from: '2026-08-10',
      to: '2026-11-10',
    });
    expect(
      discoverRange({ ...base, period: 'custom', from: '2025-01-01', to: '2025-06-30' }, NOW),
    ).toEqual({ from: '2025-01-01', to: '2025-06-30' });
    expect(
      discoverRange({ ...base, period: 'custom', from: '2025-06-30', to: '2025-01-01' }, NOW),
    ).toEqual({ from: '2025-01-01', to: '2025-06-30' });
    expect(discoverRange({ ...base, period: 'custom' }, NOW)).toEqual({
      from: '1900-01-01',
      to: '2026-11-10',
    });
  });

  it('labels subject matches and drops library papers', () => {
    const owned = parseCandidate(makeWork('W1', 'Owned work', [], []));
    const fresh = parseCandidate(makeWork('W2', 'Fresh work', [], []));
    const library = [
      { ...makePaper('2026-01-01', 'x'), info: { ...EMPTY_INFO, title: 'Owned work' } },
    ];
    const hits = subjectHits([owned, fresh], library);
    expect(hits.map((hit) => hit.info.title)).toEqual(['Fresh work']);
    expect(hits[0]?.reasons).toEqual(['Matches your subject']);
  });

  it('uses a custom reason for text matches', () => {
    const hit = parseCandidate(makeWork('W2', 'Fresh work', [], []));
    expect(subjectHits([hit], [], 'Matches your text')[0]?.reasons).toEqual(['Matches your text']);
  });

  it('tells text scopes from paper scopes', () => {
    expect(isTextScope('subject')).toBe(true);
    expect(isTextScope('custom')).toBe(true);
    expect(isTextScope('library')).toBe(false);
    expect(isTextScope('recent')).toBe(false);
  });

  it('builds the default request from stored settings, ignoring invalid values', () => {
    expect(defaultDiscoverRequest('custom', '6')).toEqual({
      scope: 'custom',
      period: 6,
      from: null,
      to: null,
      custom: '',
    });
    expect(defaultDiscoverRequest('recent', 'custom').period).toBe('custom');
    const fallback = defaultDiscoverRequest('nope', '7');
    expect(fallback.scope).toBe('library');
    expect(fallback.period).toBe(1);
  });

  it('lists titled library papers for the AI, newest upload first, capped', () => {
    const old = {
      ...makePaper('2026-01-01', 'a'),
      info: { ...EMPTY_INFO, title: 'Old', year: '2020' },
    };
    const fresh = { ...makePaper('2026-11-01', 'b'), info: { ...EMPTY_INFO, title: 'Fresh' } };
    const untitled = makePaper('2026-11-02', '');
    expect(aiPaperContext([old, untitled, fresh])).toBe('- Fresh\n- Old (2020)');
    const many = Array.from({ length: MAX_AI_SEED_PAPERS + 5 }, (_, index) =>
      makePaper('2026-01-01', `p${String(index)}`),
    );
    expect(aiPaperContext(many).split('\n')).toHaveLength(MAX_AI_SEED_PAPERS);
  });

  it('tags AI query hits, merges duplicates across queries and drops library papers', () => {
    const shared = parseCandidate(makeWork('W1', 'Shared work', [], [])).hit;
    const only = parseCandidate(makeWork('W2', 'Second only', [], [])).hit;
    const owned = parseCandidate(makeWork('W3', 'Owned work', [], [])).hit;
    const library = [
      { ...makePaper('2026-01-01', 'x'), info: { ...EMPTY_INFO, title: 'Owned work' } },
    ];
    const hits = aiQueryHits(
      [
        [shared, owned],
        [only, shared],
      ],
      library,
    );
    expect(hits.map((hit) => hit.info.title)).toEqual(['Shared work', 'Second only']);
    expect(hits[0]?.reasons).toEqual(['AI query 1', 'AI query 2']);
    expect(hits[1]?.reasons).toEqual(['AI query 2']);
  });
});

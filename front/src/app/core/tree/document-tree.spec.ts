import type { DocumentTreeSection } from '@domain/contracts';
import {
  allSectionIds,
  countSections,
  rangeBlocks,
  rangeLabel,
  sanitizeTreeParams,
  treeDepth,
  treeExportName,
  treeJson,
} from './document-tree';

/**
 * Build a tree section.
 *
 * @param id - Section id.
 * @param range - Block range.
 * @param sections - Children.
 * @returns The section.
 */
function section(
  id: string,
  range: readonly [number, number],
  sections: readonly DocumentTreeSection[] = [],
): DocumentTreeSection {
  return { section_id: id, Title: id, Description: '', sections, paper_section_range: range };
}

const TREE = [
  section(
    '1',
    [1, 4],
    [section('1.1', [1, 2]), section('1.2', [3, 4], [section('1.2.1', [3, 3])])],
  ),
  section('2', [5, 8]),
];

describe('document tree helpers', () => {
  it('counts sections and depth on every level', () => {
    expect(countSections(TREE)).toBe(5);
    expect(treeDepth(TREE)).toBe(3);
    expect(treeDepth([])).toBe(0);
  });

  it('labels ranges', () => {
    expect(rangeLabel([3, 3])).toBe('Block 3');
    expect(rangeLabel([1, 4])).toBe('Blocks 1–4');
  });

  it('clamps parameters into backend bounds', () => {
    expect(
      sanitizeTreeParams({
        max_depth: 9,
        max_sections: 1,
        min_words: Number.NaN,
        focus: '  methods ',
        auto_depth: true,
        auto_sections: false,
      }),
    ).toEqual({
      max_depth: 5,
      max_sections: 2,
      min_words: 50,
      focus: 'methods',
      auto_depth: true,
      auto_sections: false,
    });
  });

  it('exports the tree as JSON without text, named after the document', () => {
    expect(JSON.parse(treeJson(TREE))).toEqual(TREE);
    expect(treeExportName('/shared/2026-11-16/uploads/paper.v2.pdf')).toBe('paper.v2.tree.json');
  });

  it('lists every expandable section and slices block ranges', () => {
    expect(allSectionIds(TREE)).toEqual(['1', '1.1', '1.2', '1.2.1', '2']);
    expect(rangeBlocks(['a', 'b', 'c', 'd'], [2, 3])).toEqual(['b', 'c']);
  });
});

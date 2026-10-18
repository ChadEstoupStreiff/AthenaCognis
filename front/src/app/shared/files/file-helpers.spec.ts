import { numberedName } from '../../features/capture/upload-item';
import { buildLinkGraph } from '../../features/viewer/link-graph';
import { coverageOf, diffOf } from './relations-dialog.component';
import { archiveTree } from './renderers/archive-renderer.component';
import { hexDump } from './renderers/text-renderer.component';
import { toFileRow, viewerCommands } from './file-row';

describe('file helpers', () => {
  it('builds rows and viewer routes', () => {
    expect(toFileRow('/shared/2026-01-02/notes/a.md')).toMatchObject({
      name: 'a.md',
      date: '2026-01-02',
      folder: 'notes',
      kind: 'markdown',
    });
    expect(viewerCommands('/shared/2026-01-02/notes/a b.md')).toEqual([
      '/f',
      '2026-01-02',
      'notes',
      'a b.md',
    ]);
    expect(viewerCommands('/etc/passwd')).toEqual(['/library']);
  });

  it('numbers conflicting names', () => {
    expect(numberedName('report.pdf', 2)).toBe('report (2).pdf');
    expect(numberedName('README', 3)).toBe('README (3)');
  });

  it('computes tri-state coverage and diffs', () => {
    const rows = coverageOf(['A', 'B', 'C'], [['A', 'B'], ['A']]);
    expect(rows.map((row) => row.initial)).toEqual(['all', 'some', 'none']);
    const chosen = new Map([
      ['p:B', 'all' as const],
      ['p:A', 'none' as const],
    ]);
    expect(diffOf(rows, chosen, 'p:')).toEqual({ add: ['B'], remove: ['A'] });
  });

  it('builds archive trees', () => {
    const tree = archiveTree(['a/', 'a/b.txt', 'a/c/d.txt', 'e.txt']);
    expect(tree.map((node) => node.label)).toEqual(['a', 'e.txt']);
    expect(tree[0]?.children?.map((node) => node.label)).toEqual(['b.txt', 'c']);
  });

  it('dumps hex', () => {
    expect(hexDump(new TextEncoder().encode('AB\n'))).toBe(
      `00000000  ${'41 42 0a'.padEnd(48)} AB.`,
    );
  });

  it('builds link graphs without duplicate edges', () => {
    const graph = buildLinkGraph(
      '/a',
      new Map([
        ['/a', [{ other: '/b', force: 2, comment: '' }]],
        ['/b', [{ other: '/a', force: 2, comment: '' }]],
      ]),
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});

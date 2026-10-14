import { citationEdges, type CitationRecord, type ExternalWork, neighborhood } from './citations';
import { displayTitle, type Paper } from './paper';

/** Link mode of the map. */
export type MapMode = 'citations' | 'ai';

/** Edge of the map: citation (source cites target) or AI relation. */
export interface GraphLink {
  readonly source: string;
  readonly target: string;
  readonly kind: MapMode;
  readonly force: number;
  readonly comment: string;
}

/** Undirected AI relation between two files (backend links). */
export interface AiLink {
  readonly fileA: string;
  readonly fileB: string;
  readonly force: number;
  readonly comment: string;
}

/** Display options. */
export interface MapView {
  readonly mode: MapMode;
  readonly focus: string | null;
  readonly depth: number;
  readonly timeline: boolean;
  readonly hideUnconnected: boolean;
}

/** Node ready to draw. */
export interface MapNode {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly size: number;
  readonly kind: 'library' | 'focus' | 'external';
  readonly level?: number;
}

/** One connection of a node (details panel). */
export interface Connection {
  readonly other: string;
  readonly title: string;
  readonly relation: 'cites' | 'cited-by' | 'ai';
  readonly force: number;
  readonly comment: string;
}

const BASE_NODE_SIZE = 14;
const SIZE_PER_CONNECTION = 3;
/** Largest node size (focus). */
export const MAX_NODE_SIZE = 40;
const LABEL_TITLE_LENGTH = 24;
/** Strongest AI relation. */
export const MAX_AI_FORCE = 3;

/**
 * Short node label `Author Year`, or a truncated title.
 *
 * @param paper - Paper.
 * @returns Label.
 */
export function paperLabel(paper: Paper): string {
  const author = (paper.info.authors.split('|')[0] ?? '').split(',')[0]?.trim() ?? '';
  if (author !== '') {
    return `${author} ${paper.info.year}`.trim();
  }
  const title = displayTitle(paper);
  return title.length <= LABEL_TITLE_LENGTH ? title : `${title.slice(0, LABEL_TITLE_LENGTH)}…`;
}

/**
 * Node size from its connections.
 *
 * @param connections - Links touching the node.
 * @returns Size.
 */
export function nodeSize(connections: number): number {
  return Math.min(MAX_NODE_SIZE, BASE_NODE_SIZE + SIZE_PER_CONNECTION * connections);
}

/**
 * Timeline column of each year (unknown years first).
 *
 * @param years - Years of nodes.
 * @returns Year → level.
 */
export function yearLevels(years: readonly string[]): Map<string, number> {
  const sorted = [...new Set(years)].sort((left, right) =>
    left === '' ? -1 : right === '' ? 1 : left < right ? -1 : left > right ? 1 : 0,
  );
  return new Map(sorted.map((year, level) => [year, level]));
}

/**
 * Links touching each node.
 *
 * @param links - Links.
 * @returns Node → count.
 */
export function degreesOf(links: readonly GraphLink[]): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const link of links) {
    degrees.set(link.source, (degrees.get(link.source) ?? 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) ?? 0) + 1);
  }
  return degrees;
}

/**
 * Citation links inside the library and towards the shown external works.
 *
 * @param papers - Library.
 * @param records - Path → record.
 * @param externals - External works shown.
 * @returns Links.
 */
export function citationLinks(
  papers: readonly Paper[],
  records: ReadonlyMap<string, CitationRecord>,
  externals: readonly ExternalWork[],
): GraphLink[] {
  const link = (source: string, target: string): GraphLink => ({
    source,
    target,
    kind: 'citations',
    force: 0,
    comment: '',
  });
  const inside = citationEdges(papers, records).edges.map((edge) => link(edge.citing, edge.cited));
  const outside = papers.flatMap((paper) => {
    const references = new Set(records.get(paper.path)?.references ?? []);
    return externals
      .filter((work) => references.has(work.openalexId))
      .map((work) => link(paper.path, work.openalexId));
  });
  return [...inside, ...outside];
}

/**
 * AI relations with both ends in the library, deduplicated.
 *
 * @param links - Links of every paper.
 * @param paths - Library paths.
 * @returns Graph links.
 */
export function aiGraphLinks(links: readonly AiLink[], paths: ReadonlySet<string>): GraphLink[] {
  const unique = new Map<string, GraphLink>();
  for (const link of links) {
    const [source, target] = [link.fileA, link.fileB].sort() as [string, string];
    const key = `${source}\n${target}`;
    if (paths.has(source) && paths.has(target) && source !== target && !unique.has(key)) {
      unique.set(key, { source, target, kind: 'ai', force: link.force, comment: link.comment });
    }
  }
  return [...unique.values()];
}

/**
 * Nodes to draw: focus neighborhood and unconnected filter.
 *
 * @param nodeIds - Every node.
 * @param links - Drawn links.
 * @param view - Options.
 * @returns Visible node ids.
 */
export function visibleNodes(
  nodeIds: readonly string[],
  links: readonly GraphLink[],
  view: MapView,
): Set<string> {
  let visible = new Set(nodeIds);
  if (view.focus !== null) {
    const reach = neighborhood(
      links.map((link) => [link.source, link.target] as const),
      view.focus,
      view.depth,
    );
    visible = new Set([...visible].filter((node) => reach.has(node)));
  }
  if (view.hideUnconnected) {
    const connected = degreesOf(links);
    visible = new Set([...visible].filter((node) => connected.has(node) || node === view.focus));
  }
  return visible;
}

/**
 * Nodes of library papers and external works.
 *
 * @param papers - Papers drawn.
 * @param externals - External works drawn.
 * @param degrees - Node → connections.
 * @param view - Options.
 * @returns Nodes.
 */
export function mapNodes(
  papers: readonly Paper[],
  externals: readonly ExternalWork[],
  degrees: ReadonlyMap<string, number>,
  view: MapView,
): MapNode[] {
  const levels = yearLevels([
    ...papers.map((paper) => paper.info.year),
    ...externals.map((work) => work.year),
  ]);
  const level = (year: string): { level?: number } =>
    view.timeline ? { level: levels.get(year) ?? 0 } : {};
  const library = papers.map((paper): MapNode => {
    const isFocus = paper.path === view.focus;
    return {
      id: paper.path,
      label: paperLabel(paper),
      title: displayTitle(paper),
      size: isFocus ? MAX_NODE_SIZE : nodeSize(degrees.get(paper.path) ?? 0),
      kind: isFocus ? 'focus' : 'library',
      ...level(paper.info.year),
    };
  });
  const outside = externals.map((work): MapNode => ({
    id: work.openalexId,
    label: `${work.firstAuthor} ${work.year}`.trim(),
    title: `${work.title}\nCited by ${String(work.libraryCitations)} of your papers`,
    size: nodeSize(work.libraryCitations),
    kind: 'external',
    ...level(work.year),
  }));
  return [...library, ...outside];
}

/**
 * Connections of a node: citations first, then AI links by strength.
 *
 * @param nodeId - Node.
 * @param links - All links.
 * @param titleOf - Node → title.
 * @returns Connections.
 */
export function connectionsOf(
  nodeId: string,
  links: readonly GraphLink[],
  titleOf: ReadonlyMap<string, string>,
): Connection[] {
  const rank = (link: GraphLink): [number, number, number] => [
    link.kind === 'ai' ? 1 : 0,
    link.source === nodeId ? 0 : 1,
    -link.force,
  ];
  return links
    .filter((link) => link.source === nodeId || link.target === nodeId)
    .sort((left, right) => {
      const [a, b] = [rank(left), rank(right)];
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    })
    .map((link) => {
      const other = link.source === nodeId ? link.target : link.source;
      const relation = link.kind === 'ai' ? 'ai' : link.source === nodeId ? 'cites' : 'cited-by';
      return {
        other,
        title: titleOf.get(other) ?? other,
        relation,
        force: link.force,
        comment: link.comment,
      };
    });
}

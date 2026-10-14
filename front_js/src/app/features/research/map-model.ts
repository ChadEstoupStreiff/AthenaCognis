import type { GraphEdge, GraphNode } from '../../shared/ui/graph.component';
import { MAX_AI_FORCE, type GraphLink, type MapNode } from '@domain/sota';

/** Node colors (semantic, readable in both themes). */
export const NODE_COLORS: Readonly<Record<MapNode['kind'], string>> = {
  library: '#2e9e5b',
  focus: '#d9480f',
  external: '#8a9bb5',
};

/**
 * vis-network nodes.
 *
 * @param nodes - Map nodes.
 * @param fontColor - Label color.
 * @returns Graph nodes.
 */
export function toGraphNodes(nodes: readonly MapNode[], fontColor: string): GraphNode[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    title: node.title,
    size: node.size,
    shape: 'dot',
    color: NODE_COLORS[node.kind],
    font: { color: fontColor },
    ...(node.level === undefined ? {} : { level: node.level }),
  }));
}

/**
 * vis-network edges (AI width reflects strength).
 *
 * @param links - Links.
 * @returns Graph edges.
 */
export function toGraphEdges(links: readonly GraphLink[]): GraphEdge[] {
  return links.map((link, index) => ({
    id: `${String(index)}:${link.source}>${link.target}`,
    from: link.source,
    to: link.target,
    ...(link.kind === 'ai'
      ? {
          width: 1 + link.force,
          title: `Strength ${link.force.toFixed(1)} / ${MAX_AI_FORCE.toFixed(0)} — ${link.comment}`,
        }
      : { title: 'cites' }),
  }));
}

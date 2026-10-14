import type { FileLink } from '@domain/contracts';
import { fileNameOf } from '@domain/files';
import type { GraphEdge, GraphNode } from '../../shared/ui/graph.component';

const CENTER_COLOR = '#d9480f';
const NODE_COLOR = '#7c3aed';
const CENTER_SIZE = 26;
const NODE_SIZE = 16;
const LABEL_LENGTH = 28;
const EDGE_WIDTH_PER_FORCE = 1.5;

/**
 * Shorten a file name for a node label.
 *
 * @param path - File path.
 * @returns Label.
 */
function label(path: string): string {
  const name = fileNameOf(path);
  return name.length > LABEL_LENGTH ? `${name.slice(0, LABEL_LENGTH - 1)}…` : name;
}

/**
 * Build graph data from link lists keyed by file.
 *
 * @param center - File at the center.
 * @param linksByFile - Links of each explored file.
 * @returns Nodes and edges.
 */
export function buildLinkGraph(
  center: string,
  linksByFile: ReadonlyMap<string, readonly FileLink[]>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addNode = (path: string): void => {
    if (!nodes.has(path)) {
      const isCenter = path === center;
      nodes.set(path, {
        id: path,
        label: label(path),
        title: path,
        color: isCenter ? CENTER_COLOR : NODE_COLOR,
        size: isCenter ? CENTER_SIZE : NODE_SIZE,
        shape: 'dot',
      });
    }
  };
  addNode(center);
  for (const [file, links] of linksByFile) {
    addNode(file);
    for (const link of links) {
      addNode(link.other);
      const id = [file, link.other].sort().join('\u0000');
      edges.set(id, {
        id,
        from: file,
        to: link.other,
        width: link.force * EDGE_WIDTH_PER_FORCE,
        title: link.comment,
      });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

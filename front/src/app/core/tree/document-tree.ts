import type { DocumentTreeParams, DocumentTreeSection } from '@domain/contracts';
import { DOCUMENT_TREE_LIMITS } from '@domain/contracts';

const JSON_INDENT = 2;
/** Number of bar colors cycled through by depth (see document-tree.component.scss). */
export const DEPTH_COLORS = 5;
const EXPORT_SUFFIX = '.tree.json';

/**
 * Number of sections of a tree, every level included.
 *
 * @param sections - Top sections.
 * @returns Count.
 */
export function countSections(sections: readonly DocumentTreeSection[]): number {
  return sections.reduce((sum, section) => sum + 1 + countSections(section.sections), 0);
}

/**
 * Deepest level of a tree.
 *
 * @param sections - Top sections.
 * @returns Depth (0 for an empty tree).
 */
export function treeDepth(sections: readonly DocumentTreeSection[]): number {
  return sections.reduce(
    (deepest, section) => Math.max(deepest, 1 + treeDepth(section.sections)),
    0,
  );
}

/**
 * Human label of a block range.
 *
 * @param range - First and last block.
 * @returns "Blocks a–b", or "Block a" for one block.
 */
export function rangeLabel(range: readonly [number, number]): string {
  const [start, end] = range;
  return start === end ? `Block ${String(start)}` : `Blocks ${String(start)}–${String(end)}`;
}

/**
 * Clamp a number into inclusive bounds (non-numbers fall back to the minimum).
 *
 * @param value - Value.
 * @param bounds - Bounds.
 * @param bounds.min - Minimum.
 * @param bounds.max - Maximum.
 * @returns Clamped integer.
 */
function clamp(value: number, bounds: { readonly min: number; readonly max: number }): number {
  return Number.isFinite(value)
    ? Math.min(bounds.max, Math.max(bounds.min, Math.round(value)))
    : bounds.min;
}

/**
 * Bring tree parameters within the backend bounds.
 *
 * @param params - Raw form values.
 * @returns Valid parameters.
 */
export function sanitizeTreeParams(params: DocumentTreeParams): DocumentTreeParams {
  return {
    max_depth: clamp(params.max_depth, DOCUMENT_TREE_LIMITS.max_depth),
    max_sections: clamp(params.max_sections, DOCUMENT_TREE_LIMITS.max_sections),
    min_words: clamp(params.min_words, DOCUMENT_TREE_LIMITS.min_words),
    focus: params.focus.trim().slice(0, DOCUMENT_TREE_LIMITS.focusChars),
    auto_depth: params.auto_depth,
    auto_sections: params.auto_sections,
  };
}

/**
 * Exported JSON text of a tree.
 *
 * @param sections - Top sections.
 * @returns Pretty JSON.
 */
export function treeJson(sections: readonly DocumentTreeSection[]): string {
  return JSON.stringify(sections, null, JSON_INDENT);
}

/**
 * File name of an exported tree.
 *
 * @param path - Document path.
 * @returns "<name>.tree.json".
 */
export function treeExportName(path: string): string {
  const name = path.split('/').pop() ?? 'document';
  return `${name.replace(/\.[^.]+$/, '')}${EXPORT_SUFFIX}`;
}

/**
 * Ids of every section that can be expanded, every level included.
 *
 * @param sections - Top sections.
 * @returns Section ids.
 */
export function allSectionIds(sections: readonly DocumentTreeSection[]): string[] {
  return sections.flatMap((section) => [section.section_id, ...allSectionIds(section.sections)]);
}

/**
 * Blocks of a range.
 *
 * @param blocks - Every block of the document.
 * @param range - First and last block, 1-based inclusive.
 * @returns Blocks of the range (fewer when the document shrank).
 */
export function rangeBlocks(
  blocks: readonly string[],
  range: readonly [number, number],
): readonly string[] {
  return blocks.slice(range[0] - 1, range[1]);
}

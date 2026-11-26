import type { EditorCommand } from './markdown-editor-commands';
import type { MarkdownEditorComponent } from './markdown-editor.component';
import type { LineMarker } from '../text/markdown-format';
import type { ColumnAlign, TableOperation } from '../text/markdown-table';

/** Inline formatting button. */
export interface InlineTool {
  readonly label: string;
  readonly tooltip: string;
  readonly before: string;
  readonly after: string;
  readonly className: string;
}

/** Icon button running an editor action. */
export interface ActionTool {
  readonly icon: string;
  readonly tooltip: string;
  readonly run: (editor: MarkdownEditorComponent) => void;
}

/** Table operation button. */
export interface TableTool {
  readonly icon: string;
  readonly label: string;
  readonly operation: TableOperation;
}

/** Row of the cheatsheet. */
export interface CheatsheetRow {
  readonly syntax: string;
  readonly result: string;
}

export const MAX_HEADING_LEVEL = 6;
export const TABLE_PICKER_ROWS = 6;
export const TABLE_PICKER_COLUMNS = 8;
export const DEFAULT_CUSTOM_COLOR = '#2563eb';
export const IMAGE_WIDTHS = ['25%', '50%', '75%', '100%'];

const CODE_FENCE = '```\ncode\n```';
const HORIZONTAL_RULE = '---';
const DETAILS_BLOCK = '<details>\n<summary>Summary</summary>\n\nHidden content\n\n</details>';
const MATH_BLOCK = '$$\nE = mc^2\n$$';
const MERMAID_BLOCK =
  '```mermaid\nflowchart LR\n  A[Start] --> B{Choice}\n  B -->|Yes| C[Done]\n  B -->|No| A\n```';

/**
 * Button running a built-in editor command.
 *
 * @param icon - Icon class.
 * @param tooltip - Tooltip.
 * @param command - Command.
 * @returns Tool.
 */
function commandTool(icon: string, tooltip: string, command: EditorCommand): ActionTool {
  return {
    icon,
    tooltip,
    run: (editor: MarkdownEditorComponent): void => {
      editor.command(command);
    },
  };
}

export const HISTORY_TOOLS: readonly ActionTool[] = [
  commandTool('pi pi-undo', 'Undo (⌘Z)', 'undo'),
  commandTool('pi pi-refresh', 'Redo (⇧⌘Z)', 'redo'),
];

export const INLINE_TOOLS: readonly InlineTool[] = [
  { label: 'B', tooltip: 'Bold (⌘B)', before: '**', after: '**', className: 'bold' },
  { label: 'I', tooltip: 'Italic (⌘I)', before: '*', after: '*', className: 'italic' },
  { label: 'U', tooltip: 'Underline', before: '<u>', after: '</u>', className: 'underline' },
  { label: 'S', tooltip: 'Strikethrough', before: '~~', after: '~~', className: 'strike' },
  { label: '</>', tooltip: 'Inline code', before: '`', after: '`', className: 'mono' },
  { label: '∑', tooltip: 'Inline math ($…$)', before: '$', after: '$', className: 'math' },
];

/**
 * Button toggling a line marker.
 *
 * @param icon - Icon class.
 * @param tooltip - Tooltip.
 * @param marker - Marker.
 * @returns Tool.
 */
function markerTool(icon: string, tooltip: string, marker: LineMarker): ActionTool {
  return {
    icon,
    tooltip,
    run: (editor: MarkdownEditorComponent): void => {
      editor.lineMarker(marker);
    },
  };
}

/**
 * Button inserting a block.
 *
 * @param icon - Icon class.
 * @param tooltip - Tooltip.
 * @param block - Block text.
 * @returns Tool.
 */
function blockTool(icon: string, tooltip: string, block: string): ActionTool {
  return {
    icon,
    tooltip,
    run: (editor: MarkdownEditorComponent): void => {
      editor.block(block);
    },
  };
}

export const BLOCK_TOOLS: readonly ActionTool[] = [
  markerTool('pi pi-list', 'Bullet list', 'bullet'),
  markerTool('pi pi-sort-numeric-down', 'Numbered list', 'ordered'),
  markerTool('pi pi-check-square', 'Task list', 'task'),
  commandTool('pi pi-angle-double-right', 'Indent (Tab)', 'indent'),
  commandTool('pi pi-angle-double-left', 'Outdent (⇧Tab)', 'outdent'),
  markerTool('pi pi-comment', 'Quote', 'quote'),
  blockTool('pi pi-code', 'Code block', CODE_FENCE),
  blockTool('pi pi-minus', 'Divider', HORIZONTAL_RULE),
  {
    icon: 'pi pi-link',
    tooltip: 'Link (⌘K) — or paste a URL over selected text',
    run: (editor: MarkdownEditorComponent): void => {
      editor.link();
    },
  },
];

export const INSERT_BLOCKS = [
  { label: 'Collapsible section', icon: 'pi pi-chevron-circle-down', block: DETAILS_BLOCK },
  { label: 'Math block', icon: 'pi pi-percentage', block: MATH_BLOCK },
  { label: 'Mermaid diagram', icon: 'pi pi-sitemap', block: MERMAID_BLOCK },
] as const;

export const CALLOUTS = ['Note', 'Tip', 'Important', 'Warning', 'Caution'] as const;

/**
 * Callout block of a kind.
 *
 * @param kind - Callout kind.
 * @returns Markdown.
 */
export function calloutBlock(kind: string): string {
  return `> [!${kind.toUpperCase()}]\n> ${kind} text`;
}

export const FONT_SIZES = [
  { label: 'Small', value: '0.85em' },
  { label: 'Large', value: '1.25em' },
  { label: 'Extra large', value: '1.6em' },
  { label: 'Huge', value: '2em' },
];

export const TEXT_COLORS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#6b7280',
];

export const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#fed7aa', '#e5e7eb'];

/**
 * Alignment button of the table tools.
 *
 * @param align - Alignment.
 * @param icon - Icon.
 * @param label - Label.
 * @returns Tool.
 */
function alignTool(align: ColumnAlign, icon: string, label: string): TableTool {
  return { icon, label, operation: { kind: 'align', align } };
}

export const TABLE_TOOLS: readonly TableTool[] = [
  { icon: 'pi pi-arrow-down', label: 'Add row below', operation: { kind: 'insertRow' } },
  { icon: 'pi pi-arrow-right', label: 'Add column right', operation: { kind: 'insertColumn' } },
  { icon: 'pi pi-times', label: 'Delete row', operation: { kind: 'deleteRow' } },
  { icon: 'pi pi-times-circle', label: 'Delete column', operation: { kind: 'deleteColumn' } },
  alignTool('left', 'pi pi-align-left', 'Align column left'),
  alignTool('center', 'pi pi-align-center', 'Align column center'),
  alignTool('right', 'pi pi-align-right', 'Align column right'),
  { icon: 'pi pi-table', label: 'Format table', operation: { kind: 'format' } },
];

export const CHEATSHEET: readonly CheatsheetRow[] = [
  { syntax: '# Title / ## Section', result: 'Headings' },
  { syntax: '**bold** *italic* ~~strike~~', result: 'Emphasis' },
  { syntax: '- item / 1. item / - [ ] task', result: 'Lists (Tab to nest)' },
  { syntax: '[label](https://…)', result: 'Link' },
  { syntax: '![alt](url)', result: 'Image' },
  { syntax: '> [!NOTE] text', result: 'Callout' },
  { syntax: '`code` / ```lang', result: 'Code' },
  { syntax: '$x^2$ / $$…$$', result: 'Math (KaTeX)' },
  { syntax: '```mermaid', result: 'Diagram' },
  { syntax: '| a | b |', result: 'Table' },
  { syntax: '@name #tag +project', result: 'Link people, tags, projects' },
  { syntax: '[[file', result: 'Link a post-it or file' },
  { syntax: ':smile', result: 'Emoji' },
  { syntax: '⌘F', result: 'Find & replace' },
];

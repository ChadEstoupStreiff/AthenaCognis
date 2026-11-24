import { scanLines, type SourceLine } from './markdown-structure';

/** Column alignment. */
export type ColumnAlign = 'none' | 'left' | 'center' | 'right';

/** Parsed GFM table. */
export interface MarkdownTable {
  /** Header row first, then body rows (separator excluded). */
  readonly rows: readonly (readonly string[])[];
  readonly aligns: readonly ColumnAlign[];
}

/** Table found around a position. */
export interface TableAtCursor {
  readonly from: number;
  readonly to: number;
  readonly table: MarkdownTable;
  /** Row of the cursor (0 = header; the separator counts as the header). */
  readonly row: number;
  readonly column: number;
}

/** Edit applied to the table at the cursor. */
export type TableOperation =
  | { readonly kind: 'insertRow' }
  | { readonly kind: 'deleteRow' }
  | { readonly kind: 'insertColumn' }
  | { readonly kind: 'deleteColumn' }
  | { readonly kind: 'align'; readonly align: ColumnAlign }
  | { readonly kind: 'format' };

const TABLE_LINE = /^\s*\|/;
const SEPARATOR_CELL = /^:?-{1,}:?$/;
const MIN_DASHES = 3;

/**
 * Split a table row into trimmed cells (escaped pipes kept).
 *
 * @param line - Row text.
 * @returns Cells.
 */
export function splitRow(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

/**
 * Alignment declared by a separator cell.
 *
 * @param cell - Separator cell such as `:---:`.
 * @returns Alignment.
 */
function alignOf(cell: string): ColumnAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) {
    return 'center';
  }
  return left ? 'left' : right ? 'right' : 'none';
}

/**
 * Parse table lines (header, separator, body).
 *
 * @param lines - Lines.
 * @returns Table, or `null` when the second line is not a separator.
 */
export function parseTable(lines: readonly string[]): MarkdownTable | null {
  const [header, separator, ...body] = lines;
  if (header === undefined || separator === undefined) {
    return null;
  }
  const separatorCells = splitRow(separator);
  if (!separatorCells.every((cell) => SEPARATOR_CELL.test(cell))) {
    return null;
  }
  const width = separatorCells.length;
  const normalize = (cells: string[]): string[] =>
    Array.from({ length: width }, (_, index) => cells[index] ?? '');
  return {
    rows: [normalize(splitRow(header)), ...body.map((line) => normalize(splitRow(line)))],
    aligns: separatorCells.map(alignOf),
  };
}

/**
 * Separator cell for an alignment and width.
 *
 * @param align - Alignment.
 * @param width - Column width.
 * @returns Separator cell.
 */
function separatorCell(align: ColumnAlign, width: number): string {
  const dashes = '-'.repeat(Math.max(MIN_DASHES, width));
  switch (align) {
    case 'left':
      return `:${dashes.slice(1)}`;
    case 'right':
      return `${dashes.slice(1)}:`;
    case 'center':
      return `:${dashes.slice(2)}:`;
    case 'none':
      return dashes;
  }
}

/**
 * Pad a cell to a width honoring its alignment.
 *
 * @param cell - Cell text.
 * @param width - Width.
 * @param align - Alignment.
 * @returns Padded cell.
 */
function padCell(cell: string, width: number, align: ColumnAlign): string {
  const gap = width - cell.length;
  if (align === 'right') {
    return `${' '.repeat(gap)}${cell}`;
  }
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return `${' '.repeat(left)}${cell}${' '.repeat(gap - left)}`;
  }
  return `${cell}${' '.repeat(gap)}`;
}

/**
 * Render a table with aligned pipes.
 *
 * @param table - Table.
 * @returns Markdown lines joined by newlines.
 */
export function formatTable(table: MarkdownTable): string {
  const widths = table.aligns.map((_, column) =>
    Math.max(MIN_DASHES, ...table.rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const render = (row: readonly string[]): string =>
    line(
      widths.map((width, column) =>
        padCell(row[column] ?? '', width, table.aligns[column] ?? 'none'),
      ),
    );
  const [header = [], ...body] = table.rows;
  const separator = line(
    widths.map((width, column) => separatorCell(table.aligns[column] ?? 'none', width)),
  );
  return [render(header), separator, ...body.map(render)].join('\n');
}

/**
 * Range of contiguous table lines around a line.
 *
 * @param lines - Document lines.
 * @param index - Line inside the table.
 * @returns First and last line indexes.
 */
function tableBounds(lines: readonly SourceLine[], index: number): { first: number; last: number } {
  const isTableLine = (position: number): boolean => {
    const line = lines[position];
    return line !== undefined && !line.inFence && TABLE_LINE.test(line.text);
  };
  let first = index;
  let last = index;
  while (isTableLine(first - 1)) first -= 1;
  while (isTableLine(last + 1)) last += 1;
  return { first, last };
}

/**
 * Column of a cursor inside a table row.
 *
 * @param before - Row text before the cursor.
 * @param width - Column count.
 * @returns 0-based column.
 */
function cursorColumn(before: string, width: number): number {
  const pipes = (before.match(/(?<!\\)\|/g) ?? []).length;
  const leading = TABLE_LINE.test(before) ? 1 : 0;
  return Math.min(Math.max(pipes - leading, 0), width - 1);
}

/**
 * Find the table containing a position.
 *
 * @param doc - Markdown.
 * @param position - Cursor offset.
 * @returns Table and cursor cell, or `null` outside a table.
 */
export function findTable(doc: string, position: number): TableAtCursor | null {
  const lines = scanLines(doc);
  const cursorIndex = lines.findIndex((line) => position <= line.from + line.text.length);
  const cursorLine = lines[cursorIndex];
  if (cursorLine === undefined || cursorLine.inFence || !TABLE_LINE.test(cursorLine.text)) {
    return null;
  }
  const { first, last } = tableBounds(lines, cursorIndex);
  const block = lines.slice(first, last + 1);
  const table = parseTable(block.map((line) => line.text));
  const firstLine = block[0];
  const lastLine = block.at(-1);
  if (table === null || firstLine === undefined || lastLine === undefined) {
    return null;
  }
  return {
    from: firstLine.from,
    to: lastLine.from + lastLine.text.length,
    table,
    row: Math.max(cursorIndex - first - 1, 0),
    column: cursorColumn(cursorLine.text.slice(0, position - cursorLine.from), table.aligns.length),
  };
}

/**
 * Insert an item after an index.
 *
 * @param items - List.
 * @param index - Index the item follows.
 * @param value - New item.
 * @returns Copy.
 */
function insertAfter<T>(items: readonly T[], index: number, value: T): T[] {
  return [...items.slice(0, index + 1), value, ...items.slice(index + 1)];
}

/**
 * Remove the item at an index.
 *
 * @param items - List.
 * @param index - Index.
 * @returns Copy.
 */
function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, position) => position !== index);
}

/**
 * Replace one item of a list.
 *
 * @param items - List.
 * @param index - Index.
 * @param value - New value.
 * @returns Copy.
 */
function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, position) => (position === index ? value : item));
}

/**
 * Apply an operation to a table at a cell (the header row and the last column/row stay).
 *
 * @param table - Table.
 * @param row - Row of the cursor (0 = header).
 * @param column - Column of the cursor.
 * @param operation - Operation.
 * @returns New table.
 */
export function applyTableOperation(
  table: MarkdownTable,
  row: number,
  column: number,
  operation: TableOperation,
): MarkdownTable {
  const { rows, aligns } = table;
  switch (operation.kind) {
    case 'insertRow':
      return { aligns, rows: insertAfter(rows, row, Array<string>(aligns.length).fill('')) };
    case 'deleteRow':
      return row === 0 || rows.length <= 2 ? table : { aligns, rows: removeAt(rows, row) };
    case 'insertColumn':
      return {
        rows: rows.map((cells) => insertAfter(cells, column, '')),
        aligns: insertAfter<ColumnAlign>(aligns, column, 'none'),
      };
    case 'deleteColumn':
      return aligns.length <= 1
        ? table
        : { rows: rows.map((cells) => removeAt(cells, column)), aligns: removeAt(aligns, column) };
    case 'align':
      return { rows, aligns: replaceAt(aligns, column, operation.align) };
    case 'format':
      return table;
  }
}

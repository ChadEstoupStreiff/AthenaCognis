import type { TablePreview } from '@domain/contracts';
import { extensionOf } from '@domain/files';

/** A parsed sheet before truncation. */
interface RawSheet {
  readonly name: string;
  readonly rows: string[][];
}

const DELIMITED = new Set(['csv', 'tsv']);
const SPREADSHEETS = new Set(['xlsx', 'xlsm']);

/**
 * Convert a cell to display text.
 *
 * @param cell - Cell value.
 * @returns Text.
 */
export function cellText(cell: unknown): string {
  if (typeof cell === 'string') {
    return cell;
  }
  if (typeof cell === 'number' || typeof cell === 'boolean') {
    return String(cell);
  }
  if (cell instanceof Date) {
    return cell.toISOString();
  }
  return cell === null || cell === undefined ? '' : JSON.stringify(cell);
}

/**
 * Build the preview of one sheet (first row = header).
 *
 * @param sheets - Sheet names.
 * @param sheet - Selected sheet.
 * @param maxRows - Row limit.
 * @returns Preview.
 */
export function toTablePreview(
  sheets: readonly string[],
  sheet: RawSheet,
  maxRows: number,
): TablePreview {
  const [header = [], ...body] = sheet.rows;
  return {
    sheets,
    sheet: sheet.name,
    columns: header,
    rows: body.slice(0, maxRows),
    totalRows: body.length,
    truncated: body.length > maxRows,
  };
}

/**
 * Check a file can be shown as a table.
 *
 * @param path - File path.
 * @returns `true` for CSV/TSV/XLSX/XLSM.
 */
export function isTableSupported(path: string): boolean {
  const extension = extensionOf(path);
  return DELIMITED.has(extension) || SPREADSHEETS.has(extension);
}

/**
 * Parse a table file in the browser (parsers are loaded on demand).
 *
 * @param path - File path (for the format).
 * @param buffer - File bytes.
 * @param sheetName - Sheet to show.
 * @param maxRows - Row limit.
 * @returns Preview.
 * @throws Error for unsupported formats.
 */
export async function parseTable(
  path: string,
  buffer: ArrayBuffer,
  sheetName: string | undefined,
  maxRows: number,
): Promise<TablePreview> {
  const extension = extensionOf(path);
  if (DELIMITED.has(extension)) {
    const { default: Papa } = await import('papaparse');
    const result = Papa.parse<unknown[]>(new TextDecoder('utf-8').decode(buffer), {
      skipEmptyLines: true,
    });
    return toTablePreview(
      [path],
      { name: path, rows: result.data.map((row) => row.map(cellText)) },
      maxRows,
    );
  }
  if (!SPREADSHEETS.has(extension)) {
    throw new Error(`Table preview is not available for .${extension} files.`);
  }
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets: RawSheet[] = (await readXlsxFile(buffer)).map((sheet) => ({
    name: sheet.sheet,
    rows: sheet.data.map((row) => row.map(cellText)),
  }));
  const selected = sheets.find((sheet) => sheet.name === sheetName) ??
    sheets[0] ?? { name: '', rows: [] };
  return toTablePreview(
    sheets.map((sheet) => sheet.name),
    selected,
    maxRows,
  );
}

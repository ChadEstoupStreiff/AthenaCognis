import type { DataSourceOption } from '@domain/contracts';

/**
 * Entries of a one-per-line setting.
 *
 * @param text - Setting text.
 * @returns Trimmed non-blank lines.
 */
export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Append an entry to a one-per-line setting.
 *
 * @param text - Setting text.
 * @param entry - Entry to add.
 * @returns Text with the entry on its own last line (unchanged when already there).
 */
export function addLine(text: string, entry: string): string {
  const lines = linesOf(text);
  return lines.includes(entry) ? lines.join('\n') : [...lines, entry].join('\n');
}

/**
 * Suggestions not entered yet.
 *
 * @param options - Suggested entries.
 * @param text - Setting text.
 * @returns Options whose value is not a line of the text.
 */
export function pendingSuggestions(
  options: readonly DataSourceOption[],
  text: string,
): DataSourceOption[] {
  const lines = new Set(linesOf(text));
  return options.filter((option) => !lines.has(option.value));
}

/**
 * Tell whether a link leaves the app.
 *
 * @param link - Activity link.
 * @returns True for absolute http(s) URLs.
 */
export function isExternalLink(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

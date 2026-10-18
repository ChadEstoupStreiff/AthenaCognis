import type { PaperInfo } from './paper';

const APA_MAX_LISTED = 7;
const APA_HEAD = 6;
const VANCOUVER_MAX_LISTED = 6;

/**
 * Authors of a pipe-separated list.
 *
 * @param authors - `Family, Given | …`.
 * @returns Names.
 */
function authorNames(authors: string): string[] {
  return authors
    .split('|')
    .map((author) => author.trim())
    .filter(Boolean);
}

/**
 * APA author list.
 *
 * @param authors - Authors.
 * @returns Formatted list.
 */
function apaAuthors(authors: string): string {
  const names = authorNames(authors);
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  if (names.length <= APA_MAX_LISTED) {
    return `${names.slice(0, -1).join(', ')}, & ${names.at(-1) ?? ''}`;
  }
  return `${names.slice(0, APA_HEAD).join(', ')}, ... ${names.at(-1) ?? ''}`;
}

/**
 * APA reference of one paper.
 *
 * @param info - Metadata.
 * @returns Reference.
 */
function apaReference(info: PaperInfo): string {
  let reference = `${apaAuthors(info.authors)} (${info.year}). ${info.title}. ${info.journal}`;
  reference += info.volume ? `, ${info.volume}` : '';
  reference += info.issue ? `(${info.issue})` : '';
  reference += info.pages ? `, ${info.pages}` : '';
  reference += '.';
  return info.doi ? `${reference} https://doi.org/${info.doi}` : reference;
}

/**
 * Vancouver reference of one paper.
 *
 * @param info - Metadata.
 * @returns Reference.
 */
function vancouverReference(info: PaperInfo): string {
  const names = authorNames(info.authors);
  const authors =
    names.length <= VANCOUVER_MAX_LISTED
      ? names.join(', ')
      : `${names.slice(0, VANCOUVER_MAX_LISTED).join(', ')}, et al.`;
  let reference = `${authors}. ${info.title}. ${info.journal}.`;
  reference += info.volume ? ` ${info.volume}` : '';
  reference += info.issue ? `(${info.issue})` : '';
  reference += info.pages ? `:${info.pages}` : '';
  reference += `; ${info.year}.`;
  return info.doi ? `${reference} doi: https://doi.org/${info.doi}` : reference;
}

/**
 * APA references, one paragraph each (same output as the Streamlit front).
 *
 * @param infos - Metadata.
 * @returns Text.
 */
export function formatApa(infos: readonly PaperInfo[]): string {
  return infos.map(apaReference).join('\n\n').trim();
}

/**
 * Vancouver references, one paragraph each.
 *
 * @param infos - Metadata.
 * @returns Text.
 */
export function formatVancouver(infos: readonly PaperInfo[]): string {
  return infos.map(vancouverReference).join('\n\n').trim();
}

import { type Paper, type PaperStatus, shortAuthors } from '@domain/sota';

/** Icon of each paper status. */
export const STATUS_ICONS: Readonly<Record<PaperStatus, string>> = {
  Validated: 'pi pi-verified',
  'To review': 'pi pi-eye',
  'Missing info': 'pi pi-exclamation-circle',
};

/**
 * `authors · year · journal` line.
 *
 * @param paper - Paper.
 * @returns Line, or empty.
 */
export function paperDetails(paper: Paper): string {
  return [shortAuthors(paper.info.authors), paper.info.year, paper.info.journal]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

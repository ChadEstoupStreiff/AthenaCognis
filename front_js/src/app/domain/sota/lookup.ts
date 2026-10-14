import {
  EMPTY_INFO,
  INFO_TEXT_FIELDS,
  type Paper,
  type PaperInfo,
  displayTitle,
  paperFileName,
} from './paper';
import { titlesMatch } from './text';

/** Network sources of the lookup pipeline (injected, so the pipeline is testable). */
export interface LookupSources {
  /** GROBID header of a PDF; null when GROBID finds none. Throws when unreachable. */
  readonly grobidHeader: (path: string) => Promise<PaperInfo | null>;
  /** Exact CrossRef record of a DOI; null when unknown. */
  readonly crossrefByDoi: (doi: string) => Promise<PaperInfo | null>;
  /** Title searches, tried in order (CrossRef, PubMed, arXiv). */
  readonly titleSearchers: readonly ((title: string) => Promise<PaperInfo[]>)[];
  /** Called when a source fails (the pipeline goes on). */
  readonly onError?: (source: string, error: unknown) => void;
}

/** What the pipeline found for one paper. */
export interface LookupResult {
  /** Merged metadata (not validated). */
  readonly info: PaperInfo;
  /** Metadata read from the PDF by GROBID. */
  readonly extracted: PaperInfo | null;
  /** Metadata found online. */
  readonly online: PaperInfo | null;
}

const PDF_EXTENSION = '.pdf';

/**
 * Overlay non-empty fields of `override` on `base` (validated and source come from base).
 *
 * @param base - Fallback metadata.
 * @param override - Preferred metadata.
 * @returns Merged metadata.
 */
export function mergeInfo(base: PaperInfo, override: PaperInfo): PaperInfo {
  const merged: Record<string, string | boolean> = { ...base };
  for (const field of INFO_TEXT_FIELDS) {
    if (field !== 'source' && override[field] !== '') {
      merged[field] = override[field];
    }
  }
  return merged as unknown as PaperInfo;
}

/**
 * Run a lookup, swallowing failures.
 *
 * @param name - Source name (for `onError`).
 * @param call - Lookup.
 * @param sources - Sources (error callback).
 * @returns Result, or null on failure.
 */
async function safeCall<T>(
  name: string,
  call: () => Promise<T>,
  sources: LookupSources,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    sources.onError?.(name, error);
    return null;
  }
}

/**
 * First candidate whose title really matches, across all title searchers.
 *
 * @param title - Title.
 * @param sources - Sources.
 * @returns Metadata, or null.
 */
async function searchByTitle(title: string, sources: LookupSources): Promise<PaperInfo | null> {
  for (const searcher of sources.titleSearchers) {
    const candidates = (await safeCall('title search', () => searcher(title), sources)) ?? [];
    const match = candidates.find((candidate) => titlesMatch(candidate.title, title));
    if (match !== undefined) {
      return match;
    }
  }
  return null;
}

/**
 * Resolve metadata online: DOI first, then a verified title match.
 *
 * @param extracted - Metadata read from the PDF.
 * @param title - Title to search when no DOI resolves.
 * @param sources - Sources.
 * @returns Metadata, or null.
 */
async function lookupOnline(
  extracted: PaperInfo | null,
  title: string,
  sources: LookupSources,
): Promise<PaperInfo | null> {
  if (extracted !== null && extracted.doi !== '') {
    const doi = extracted.doi;
    const byDoi = await safeCall('crossref', () => sources.crossrefByDoi(doi), sources);
    if (byDoi !== null) {
      return byDoi;
    }
  }
  return title === '' ? null : searchByTitle(title, sources);
}

/**
 * Read the PDF header with GROBID, then complete it from CrossRef / PubMed / arXiv.
 *
 * @param paper - Paper.
 * @param sources - Sources.
 * @returns What was found, or null when nothing was.
 */
export async function lookupPaper(
  paper: Paper,
  sources: LookupSources,
): Promise<LookupResult | null> {
  const isPdf = paperFileName(paper).toLowerCase().endsWith(PDF_EXTENSION);
  const extracted = isPdf
    ? await safeCall('grobid', () => sources.grobidHeader(paper.path), sources)
    : null;
  const title =
    extracted !== null && extracted.title !== '' ? extracted.title : displayTitle(paper);
  const online = await lookupOnline(extracted, title, sources);
  const origin = [extracted === null ? '' : 'grobid', online === null ? '' : online.source].filter(
    Boolean,
  );
  if (origin.length === 0) {
    return null;
  }
  const merged = mergeInfo(mergeInfo(paper.info, extracted ?? EMPTY_INFO), online ?? EMPTY_INFO);
  return { info: { ...merged, source: origin.join(' + '), validated: false }, extracted, online };
}

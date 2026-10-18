import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  ATTACHMENTS_FOLDER,
  type BibEntry,
  fileBasename,
  parseBibtex,
  parseRis,
} from './bibliography';

/** Uploaded file. */
export interface UploadedSource {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Bibliographies and PDFs gathered from uploads (zip archives are opened). */
export interface ImportSources {
  readonly bibtex: string[];
  readonly ris: string[];
  readonly pdfs: Map<string, Uint8Array>;
}

const MAC_METADATA = '__MACOSX';

/**
 * Same-realm byte array (fflate tells files from folders with `instanceof Uint8Array`).
 *
 * @param bytes - Bytes, possibly from another realm (iframe, test DOM).
 * @returns Bytes usable by fflate (copied only when needed).
 */
function localBytes(bytes: Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Sort one file into the sources by extension.
 *
 * @param sources - Accumulator (updated).
 * @param name - File name.
 * @param bytes - Content.
 */
function addSource(sources: ImportSources, name: string, bytes: Uint8Array): void {
  const lower = name.toLowerCase();
  if (lower.endsWith('.bib')) {
    sources.bibtex.push(new TextDecoder('utf-8').decode(bytes));
  } else if (lower.endsWith('.ris')) {
    sources.ris.push(new TextDecoder('utf-8').decode(bytes));
  } else if (lower.endsWith('.pdf')) {
    sources.pdfs.set(fileBasename(name), bytes);
  }
}

/**
 * Gather bibliographies and PDFs from uploads and zip archives (Zotero export folders).
 *
 * @param uploads - Uploaded files.
 * @returns Sources.
 * @throws Error when a zip is corrupted.
 */
export function collectSources(uploads: readonly UploadedSource[]): ImportSources {
  const sources: ImportSources = { bibtex: [], ris: [], pdfs: new Map() };
  for (const upload of uploads) {
    if (!upload.name.toLowerCase().endsWith('.zip')) {
      addSource(sources, upload.name, upload.bytes);
      continue;
    }
    for (const [member, bytes] of Object.entries(unzipSync(localBytes(upload.bytes)))) {
      if (!member.endsWith('/') && !member.includes(MAC_METADATA)) {
        addSource(sources, member, bytes);
      }
    }
  }
  return sources;
}

/**
 * Entries of every bibliography.
 *
 * @param sources - Sources.
 * @returns BibTeX entries, then RIS entries.
 */
export function parseSources(sources: ImportSources): BibEntry[] {
  return [...sources.bibtex.flatMap(parseBibtex), ...sources.ris.flatMap(parseRis)];
}

/**
 * Zip a bibliography with its PDFs (under `files/`).
 *
 * @param name - Bibliography file name.
 * @param bibliography - Content.
 * @param pdfs - PDF name → content.
 * @returns Zip bytes.
 */
export function buildZip(
  name: string,
  bibliography: string,
  pdfs: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const files: Record<string, Uint8Array> = { [name]: localBytes(strToU8(bibliography)) };
  for (const [pdf, bytes] of pdfs) {
    files[`${ATTACHMENTS_FOLDER}/${pdf}`] = localBytes(bytes);
  }
  return zipSync(files);
}

/**
 * Decode UTF-8 bytes (tests and previews).
 *
 * @param bytes - Bytes.
 * @returns Text.
 */
export function utf8(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

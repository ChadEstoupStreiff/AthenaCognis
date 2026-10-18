import { buildSharedPath } from './shared-path';

/** Extensions the backend converts on upload, mapped to the stored extension. */
const CONVERTED_EXTENSIONS: Readonly<Record<string, string>> = {
  '.heic': '.png',
  '.m4a': '.mp3',
};

/** File name split into stem and extension (extension keeps its dot). */
export interface NameParts {
  readonly stem: string;
  readonly extension: string;
}

/**
 * Split a file name like Python's `os.path.splitext` (leading dots are not an extension).
 *
 * @param name - File name without folders.
 * @returns The stem and the extension (empty when there is none).
 */
export function splitExtension(name: string): NameParts {
  const dotIndex = name.lastIndexOf('.');
  const firstNonDot = name.search(/[^.]/);
  if (dotIndex <= 0 || firstNonDot === -1 || dotIndex < firstNonDot) {
    return { stem: name, extension: '' };
  }
  return { stem: name.slice(0, dotIndex), extension: name.slice(dotIndex) };
}

/**
 * Apply the backend's upload name sanitization (`/` and `\` → `_`, `:` → `-`, `?` removed).
 *
 * @param name - Requested file name.
 * @returns The name the backend will use before format conversion.
 */
export function sanitizeUploadName(name: string): string {
  return name.replaceAll('/', '_').replaceAll('\\', '_').replaceAll(':', '-').replaceAll('?', '');
}

/**
 * Predict the stored file name, including the backend's format conversions.
 *
 * @param name - Requested file name (also used as the multipart filename).
 * @returns The final stored name (`.heic` → `.png`, `.m4a` → `.mp3`).
 */
export function predictStoredName(name: string): string {
  const sanitized = sanitizeUploadName(name);
  const { stem, extension } = splitExtension(sanitized);
  const converted = CONVERTED_EXTENSIONS[extension.toLowerCase()];
  return converted === undefined ? sanitized : `${stem}${converted}`;
}

/**
 * Predict the absolute path the backend stores an uploaded file at.
 *
 * @param date - Upload date `YYYY-MM-DD`.
 * @param folder - Target subfolder (uploads, notes, audio).
 * @param name - Requested file name.
 * @returns The predicted absolute shared path.
 */
export function predictStoredPath(date: string, folder: string, name: string): string {
  return buildSharedPath({ date, folder, name: predictStoredName(name) });
}

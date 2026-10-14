/** Root folder holding every user file inside the backend container. */
export const SHARED_ROOT = '/shared';

/** Subfolders the application writes into. */
export const KNOWN_SUBFOLDERS = ['uploads', 'notes', 'audio'] as const;

/** One of the subfolders the application writes into. */
export type KnownSubfolder = (typeof KNOWN_SUBFOLDERS)[number];

const SHARED_PATH_PATTERN = /^\/shared\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]+)\/([^/\0]+)$/;
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['.', '..']);

/** Components of a `/shared/<date>/<folder>/<name>` file path. */
export interface SharedPathParts {
  readonly date: string;
  readonly folder: string;
  readonly name: string;
}

/**
 * Split a shared file path into date, folder and name.
 *
 * @param path - Absolute path such as `/shared/2025-08-29/uploads/a.pdf`.
 * @returns The path components, or `null` when the path is not a valid shared file path.
 */
export function parseSharedPath(path: string): SharedPathParts | null {
  const match = SHARED_PATH_PATTERN.exec(path);
  const date = match?.[1];
  const folder = match?.[2];
  const name = match?.[3];
  if (date === undefined || folder === undefined || name === undefined) {
    return null;
  }
  if (FORBIDDEN_NAMES.has(name)) {
    return null;
  }
  return { date, folder, name };
}

/**
 * Check that a path points to a user file under `/shared` (no traversal, no hidden folders).
 *
 * @param path - Candidate path.
 * @returns `true` when the path is a valid shared file path.
 */
export function isSharedFilePath(path: string): boolean {
  return parseSharedPath(path) !== null;
}

/**
 * Build the absolute shared path from its components.
 *
 * @param parts - Date, folder and file name.
 * @returns The absolute path `/shared/<date>/<folder>/<name>`.
 */
export function buildSharedPath(parts: SharedPathParts): string {
  return `${SHARED_ROOT}/${parts.date}/${parts.folder}/${parts.name}`;
}

/**
 * Extract the file name (last path segment).
 *
 * @param path - Any slash-separated path.
 * @returns The last segment of the path.
 */
export function fileNameOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

/**
 * Check whether a listed path is an internal artefact (previews, avatars).
 *
 * @param path - Path returned by the backend file listing.
 * @returns `true` when one of the path segments is hidden (starts with a dot).
 */
export function isHiddenArtefactPath(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.') && segment.length > 1);
}

/**
 * Encode a file path as a single URL segment for `{file:path}` backend routes.
 *
 * @param path - Absolute shared path.
 * @returns The percent-encoded path, slashes included.
 */
export function encodeFileSegment(path: string): string {
  return encodeURIComponent(path);
}

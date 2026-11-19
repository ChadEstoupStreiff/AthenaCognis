/** One step of a folder breadcrumb. */
export interface FolderCrumb {
  readonly name: string;
  /** Path relative to the source root. */
  readonly path: string;
}

/**
 * Breadcrumb of a folder path.
 *
 * @param path - Folder relative to the root ('' for the root).
 * @returns One crumb per path part, root excluded.
 */
export function folderCrumbs(path: string): FolderCrumb[] {
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

/**
 * Add or remove a folder from the picked list.
 *
 * @param picked - Picked folders.
 * @param path - Folder to change.
 * @param isPicked - True to add, false to remove.
 * @returns New list, sorted, without duplicates.
 */
export function togglePath(picked: readonly string[], path: string, isPicked: boolean): string[] {
  const rest = picked.filter((item) => item !== path);
  return (isPicked ? [...rest, path] : rest).sort((left, right) => left.localeCompare(right));
}

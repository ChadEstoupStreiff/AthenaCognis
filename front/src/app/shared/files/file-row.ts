import {
  FILE_KIND_ICONS,
  type FileKind,
  fileKindOf,
  fileNameOf,
  parseSharedPath,
} from '@domain/files';

/** Display model of a file path. */
export interface FileRow {
  readonly path: string;
  readonly name: string;
  readonly date: string;
  readonly folder: string;
  readonly kind: FileKind;
  readonly icon: string;
}

/**
 * Build the display model of a path.
 *
 * @param path - Shared path.
 * @returns The row.
 */
export function toFileRow(path: string): FileRow {
  const parts = parseSharedPath(path);
  const kind = fileKindOf(path);
  return {
    path,
    name: parts?.name ?? fileNameOf(path),
    date: parts?.date ?? '',
    folder: parts?.folder ?? '',
    kind,
    icon: FILE_KIND_ICONS[kind],
  };
}

/**
 * Router commands of the viewer page of a file (`/f/<date>/<folder>/<name>`).
 *
 * @param path - Shared path.
 * @returns Router commands.
 */
export function viewerCommands(path: string): string[] {
  const parts = parseSharedPath(path);
  return parts === null ? ['/library'] : ['/f', parts.date, parts.folder, parts.name];
}

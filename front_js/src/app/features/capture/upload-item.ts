import { predictStoredName } from '@domain/files';

/** Upload state of one file. */
export type UploadState = 'ready' | 'conflict' | 'uploading' | 'done' | 'error';

/** One file in the upload dialog. */
export interface UploadItem {
  readonly id: number;
  readonly file: File;
  readonly name: string;
  readonly state: UploadState;
  readonly progress: number;
  readonly message: string | null;
  readonly storedPath: string | null;
  /** Per-file overrides of the dialog defaults (`null` = use defaults). */
  readonly override: UploadOverride | null;
}

/** Per-file date and relations. */
export interface UploadOverride {
  readonly date: Date;
  readonly projects: readonly string[];
  readonly tags: readonly string[];
}

/**
 * Suggest a free name by appending a counter (`a.pdf` → `a (2).pdf`).
 *
 * @param name - Original name.
 * @param attempt - Counter.
 * @returns New name.
 */
export function numberedName(name: string, attempt: number): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  return `${stem} (${String(attempt)})${extension}`;
}

/**
 * Stored name shown under the editable name (conversions and sanitization).
 *
 * @param name - Requested name.
 * @returns Stored name.
 */
export function storedNameHint(name: string): string {
  return predictStoredName(name);
}

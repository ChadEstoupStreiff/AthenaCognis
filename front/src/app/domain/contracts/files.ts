/** `GET /files/metadata/{file}` response. */
export interface FileMetadata {
  readonly size: number;
  readonly created: string;
  readonly modified: string;
  readonly path: string;
  readonly mime_type: string;
  readonly zip_paths?: readonly string[];
  readonly zip_paths_truncated?: boolean;
  readonly zip_paths_total?: number;
}

/** One file the user wants to upload. */
export interface UploadPlanItem {
  readonly name: string;
  readonly date: string;
  readonly folder: string;
}

/** Predicted storage of one upload. */
export interface UploadPlanEntry {
  readonly name: string;
  readonly storedName: string;
  readonly storedPath: string;
  readonly exists: boolean;
}

/** Relations applied to an upload. */
export interface UploadRelations {
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly contacts: readonly string[];
}

/** Result of one upload. */
export interface UploadResult {
  readonly path: string;
}

/** Projects, tags and pin state of a file. */
export interface FileRelations {
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly pinned: boolean;
}

/** Relations of many files, keyed by path. */
export type RelationsByPath = Readonly<Record<string, FileRelations>>;

/** Names to add and remove. */
export interface NameDiff {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/** Bulk edit of projects/tags on several files. */
export interface RelationsPatch {
  readonly paths: readonly string[];
  readonly projects?: NameDiff | undefined;
  readonly tags?: NameDiff | undefined;
}

/** Outcome of one operation in a bulk request. */
export interface BulkItemResult {
  readonly path: string;
  readonly ok: boolean;
  readonly message?: string;
}

/** Move/rename request. */
export interface MoveRequest {
  readonly path: string;
  readonly date?: string | undefined;
  readonly name?: string | undefined;
  readonly folder?: string | undefined;
}

/** Move/rename result. */
export interface MoveResult {
  readonly path: string;
}

/** Overwrite of a text file (notes). */
export interface TextFileWrite {
  readonly path: string;
  readonly content: string;
}

/** Tabular preview of a CSV/XLSX file. */
export interface TablePreview {
  readonly sheets: readonly string[];
  readonly sheet: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly totalRows: number;
  readonly truncated: boolean;
}

/** Ticket used to download a zip of several files with a plain link. */
export interface ZipTicket {
  readonly ticket: string;
}

/** Per-file note (`GET /notes/{file}`). */
export interface FileNote {
  readonly file: string;
  readonly date: string;
  readonly note: string;
}

/** Link between two files, as used by the SPA. */
export interface FileLink {
  readonly other: string;
  readonly force: number;
  readonly comment: string;
}

/** Link tuple as returned by `GET /links/list/{file}`. */
export type BackendLinkTuple = readonly [string, number, string | null];

/** AI link suggestion (`POST /links/auto-find`). */
export interface LinkSuggestion {
  readonly fileA: string;
  readonly fileB: string;
  readonly force: number;
  readonly comment: string;
}

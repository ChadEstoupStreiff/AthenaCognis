import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type {
  BulkItemResult,
  FileMetadata,
  MoveRequest,
  RelationsByPath,
  RelationsPatch,
  TablePreview,
  UploadPlanEntry,
  UploadPlanItem,
  UploadRelations,
} from '@domain/contracts';
import { encodeFileSegment, parseSharedPath } from '@domain/files';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { DataSync } from '../state/data-sync.service';
import { FileActions } from './file-actions';
import { RelationIndex } from './relation-index';
import { parseTable } from './table-parser';
import { type UploadProgress, Uploads, type UploadTarget } from './uploads';

export type { UploadProgress, UploadTarget } from './uploads';

const NOT_FOUND = 404;
const PARTIAL_CONTENT = 206;
const DEFAULT_TEXT_BYTES = 1_048_576;
const DEFAULT_TABLE_ROWS = 2_000;
/** Read-only `/shared` mount served by nginx (Range requests, inline). */
const RAW_PREFIX = '/raw';

/** Text read from the start of a file. */
export interface TextHead {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

/**
 * Start a browser download of a URL.
 *
 * @param url - Same-origin URL (or object URL).
 * @param fileName - Suggested file name.
 */
export function triggerDownload(url: string, fileName = ''): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Files: URLs, metadata, reads, uploads, deletes, moves, relations, zips. */
@Injectable({ providedIn: 'root' })
export class FilesApi {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly sync = inject(DataSync);
  private readonly actions = inject(FileActions);
  private readonly uploads = inject(Uploads);
  private readonly relationIndex = inject(RelationIndex);

  /**
   * URL of a file: inline from the `/shared` mount, or a backend download (attachment).
   *
   * @param path - Shared path.
   * @param disposition - Inline or attachment.
   * @returns Same-origin URL.
   */
  contentUrl(path: string, disposition: 'inline' | 'attachment' = 'inline'): string {
    const parts = parseSharedPath(path);
    if (disposition === 'attachment' || parts === null) {
      return backendUrl(`/files/download/${encodeFileSegment(path)}`);
    }
    return `${RAW_PREFIX}/${parts.date}/${parts.folder}/${encodeURIComponent(parts.name)}`;
  }

  /**
   * File metadata.
   *
   * @param path - Shared path.
   * @returns Metadata, or `null` when the file is gone.
   */
  async metadata(path: string): Promise<FileMetadata | null> {
    try {
      return await this.api.get<FileMetadata>(
        backendUrl(`/files/metadata/${encodeFileSegment(path)}`),
        { silent: true },
      );
    } catch (error) {
      if (hasStatus(error, NOT_FOUND)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Read the start of a file as UTF-8 text (Range request).
   *
   * @param path - Shared path.
   * @param maxBytes - Byte limit.
   * @returns Text, raw bytes and whether the file is longer.
   * @throws Error when the file cannot be read.
   */
  async textHead(path: string, maxBytes = DEFAULT_TEXT_BYTES): Promise<TextHead> {
    const response = await fetch(this.contentUrl(path), {
      headers: { range: `bytes=0-${String(maxBytes - 1)}` },
    });
    if (!response.ok) {
      throw new Error(`Cannot read the file (${String(response.status)}).`);
    }
    const all = new Uint8Array(await response.arrayBuffer());
    const bytes = all.subarray(0, maxBytes);
    const total = Number(response.headers.get('content-range')?.split('/')[1] ?? all.length);
    const truncated =
      response.status === PARTIAL_CONTENT ? total > maxBytes : all.length > maxBytes;
    return { text: new TextDecoder('utf-8').decode(bytes), bytes, truncated };
  }

  /**
   * Tabular preview of CSV/XLSX (parsed in the browser).
   *
   * @param path - Shared path.
   * @param sheet - Optional sheet.
   * @returns Preview.
   */
  async table(path: string, sheet?: string): Promise<TablePreview> {
    const buffer = await firstValueFrom(
      this.http.get(this.contentUrl(path), { responseType: 'arraybuffer' }),
    );
    return parseTable(path, buffer, sheet, DEFAULT_TABLE_ROWS);
  }

  /**
   * Files of a folder within a date range (quick search, no text).
   *
   * @param folder - Subfolder.
   * @param start - First day `YYYY-MM-DD`.
   * @param end - Last day `YYYY-MM-DD`.
   * @returns Paths, newest first.
   */
  listFolder(folder: string, start: string, end: string): Promise<string[]> {
    return this.api.get<string[]>(backendUrl('/files/search'), {
      params: { subfolder: folder, start_date: start, end_date: end, search_mode: 0 },
    });
  }

  /**
   * Files dated within a range, every folder (quick search, no text).
   *
   * @param start - First day.
   * @param end - Last day.
   * @param signal - Abort signal.
   * @returns Paths, newest first.
   */
  filesBetween(start: string, end: string, signal?: AbortSignal): Promise<string[]> {
    return this.api.get<string[]>(backendUrl('/files/search'), {
      params: { start_date: start, end_date: end, search_mode: 0 },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Relations of several files.
   *
   * @param paths - Paths.
   * @returns Relations keyed by path.
   */
  relations(paths: readonly string[]): Promise<RelationsByPath> {
    return paths.length === 0 ? Promise.resolve({}) : this.relationIndex.relationsOf(paths);
  }

  /**
   * Bulk add/remove projects and tags.
   *
   * @param patch - Edit.
   * @returns Per-file results.
   */
  async patchRelations(patch: RelationsPatch): Promise<BulkItemResult[]> {
    const results = await this.actions.patchRelations(patch);
    this.sync.invalidate('files', 'projects', 'tags');
    return results;
  }

  /**
   * Delete files (with recents/pins/contacts cleanup).
   *
   * @param paths - Paths.
   * @returns Per-file results.
   */
  async delete(paths: readonly string[]): Promise<BulkItemResult[]> {
    const results = await this.actions.delete(paths);
    this.sync.invalidate('files', 'pinned', 'notes');
    return results;
  }

  /**
   * Move or rename a file.
   *
   * @param request - Move request.
   * @returns The new path.
   */
  async move(request: MoveRequest): Promise<string> {
    const path = await this.actions.move(request);
    this.sync.invalidate('files', 'pinned', 'notes', 'links');
    return path;
  }

  /**
   * Create or overwrite a text file.
   *
   * @param path - Shared path.
   * @param content - Content.
   * @param silent - Skip error toasts (autosave shows its own status).
   * @returns The stored path.
   */
  async writeText(path: string, content: string, silent = false): Promise<string> {
    const stored = await this.uploads.writeText(path, content, silent);
    this.sync.invalidate('notes');
    return stored;
  }

  /**
   * Predict stored paths before uploading.
   *
   * @param items - Planned uploads.
   * @returns One entry per item.
   */
  uploadPlan(items: readonly UploadPlanItem[]): Promise<UploadPlanEntry[]> {
    return this.uploads.plan(items);
  }

  /**
   * Upload one file with progress.
   *
   * @param file - File or blob.
   * @param target - Folder, date and final name.
   * @param relations - Projects, tags and contacts.
   * @returns Progress events, then the result.
   */
  upload(file: Blob, target: UploadTarget, relations: UploadRelations): Observable<UploadProgress> {
    return this.uploads.upload(file, target, relations);
  }

  /** Refresh views after uploads. */
  uploadsFinished(): void {
    this.sync.invalidate('files', 'projects', 'tags', 'contacts', 'notes');
  }

  /**
   * Download several files as one zip.
   *
   * @param paths - Paths.
   */
  async downloadZip(paths: readonly string[]): Promise<void> {
    const blob = await firstValueFrom(
      this.http.post(backendUrl('/files/download-zip'), paths, { responseType: 'blob' }),
    );
    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'selection.zip');
    setTimeout(() => {
      URL.revokeObjectURL(url);
    });
  }
}

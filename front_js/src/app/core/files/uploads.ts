import { HttpClient, type HttpEvent, HttpEventType } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, filter, map, type Observable, switchMap, throwError } from 'rxjs';
import type {
  UploadPlanEntry,
  UploadPlanItem,
  UploadRelations,
  UploadResult,
} from '@domain/contracts';
import {
  encodeFileSegment,
  guessMime,
  parseSharedPath,
  predictStoredName,
  predictStoredPath,
} from '@domain/files';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { mapWithConcurrency } from '../util/concurrency';
import { RelationIndex } from './relation-index';

const PLAN_CONCURRENCY = 6;
const NOT_FOUND = 404;

/** Where an upload is stored. */
export interface UploadTarget {
  readonly folder: string;
  readonly date: string;
  readonly name: string;
}

/** Upload progress event. */
export type UploadProgress =
  | { readonly kind: 'progress'; readonly fraction: number }
  | { readonly kind: 'done'; readonly result: UploadResult };

/** Raised when an upload would overwrite an existing file. */
export class UploadConflictError extends Error {
  /**
   * Build the error.
   *
   * @param path - Existing file.
   */
  constructor(readonly path: string) {
    super(`A file already exists at ${path}. Rename the file before uploading.`);
    this.name = 'UploadConflictError';
  }
}

/**
 * Serialize a relation list as the backend expects (JSON array in the query).
 *
 * @param values - Names or ids.
 * @returns JSON text, or `null` when empty.
 */
function jsonList(values: readonly string[]): string | null {
  return values.length === 0 ? null : JSON.stringify(values);
}

/**
 * Map an HTTP event to upload progress.
 *
 * @param event - HTTP event.
 * @param path - Stored path.
 * @returns Progress, result, or `null` for other events.
 */
function toProgress(event: HttpEvent<unknown>, path: string): UploadProgress | null {
  if (event.type === HttpEventType.UploadProgress) {
    return {
      kind: 'progress',
      fraction: event.total === undefined ? 0 : event.loaded / event.total,
    };
  }
  return event.type === HttpEventType.Response ? { kind: 'done', result: { path } } : null;
}

/**
 * Safe uploads. The backend deletes an existing file when an upload with relations collides with it,
 * so existence is checked first, the multipart filename is the final name and the date is always sent.
 */
@Injectable({ providedIn: 'root' })
export class Uploads {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly relations = inject(RelationIndex);

  /**
   * Predict stored paths and detect collisions.
   *
   * @param items - Planned uploads.
   * @returns One entry per item.
   */
  plan(items: readonly UploadPlanItem[]): Promise<UploadPlanEntry[]> {
    return mapWithConcurrency(items, PLAN_CONCURRENCY, async (item) => {
      const storedPath = predictStoredPath(item.date, item.folder, item.name);
      return {
        name: item.name,
        storedName: predictStoredName(item.name),
        storedPath,
        exists: await this.exists(storedPath),
      };
    });
  }

  /**
   * Upload one file with progress (refused when it would overwrite a file and relations are set).
   *
   * @param file - File or blob.
   * @param target - Folder, date and final name.
   * @param relations - Projects, tags and contacts.
   * @returns Progress events, then the result.
   */
  upload(file: Blob, target: UploadTarget, relations: UploadRelations): Observable<UploadProgress> {
    const path = predictStoredPath(target.date, target.folder, target.name);
    const hasRelations =
      relations.projects.length + relations.tags.length + relations.contacts.length > 0;
    return defer(async () => hasRelations && (await this.exists(path))).pipe(
      switchMap((conflict) =>
        conflict
          ? throwError(() => new UploadConflictError(path))
          : this.send(file, target, relations, path),
      ),
    );
  }

  /**
   * Create or overwrite a text file (notes) without relations.
   *
   * @param path - Shared path.
   * @param content - Content.
   * @param silent - Skip error toasts.
   * @returns The stored path.
   * @throws Error when the path is invalid.
   */
  async writeText(path: string, content: string, silent = false): Promise<string> {
    const parts = parseSharedPath(path);
    if (parts === null) {
      throw new Error('Not a shared file path.');
    }
    const form = new FormData();
    form.append('files', new Blob([content], { type: guessMime(path) }), parts.name);
    await this.api.post(backendUrl('/files/upload'), form, {
      params: { subdirectory: parts.folder, date: parts.date },
      silent,
    });
    return path;
  }

  /**
   * Whether a file exists.
   *
   * @param path - Shared path.
   * @returns `true` when the backend knows it.
   */
  async exists(path: string): Promise<boolean> {
    try {
      await this.api.get(backendUrl(`/files/metadata/${encodeFileSegment(path)}`), {
        silent: true,
      });
      return true;
    } catch (error) {
      if (hasStatus(error, NOT_FOUND)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Send the multipart request.
   *
   * @param file - File.
   * @param target - Target.
   * @param relations - Relations.
   * @param path - Predicted path.
   * @returns Progress events.
   */
  private send(
    file: Blob,
    target: UploadTarget,
    relations: UploadRelations,
    path: string,
  ): Observable<UploadProgress> {
    const form = new FormData();
    form.append('files', file, target.name);
    const params: Record<string, string> = { subdirectory: target.folder, date: target.date };
    for (const [key, value] of Object.entries({
      projects: relations.projects,
      tags: relations.tags,
      contacts: relations.contacts,
    })) {
      const json = jsonList(value);
      if (json !== null) {
        params[key] = json;
      }
    }
    this.relations.invalidate();
    return this.http
      .post(backendUrl('/files/upload'), form, { params, reportProgress: true, observe: 'events' })
      .pipe(
        map((event) => toProgress(event, path)),
        filter((event): event is UploadProgress => event !== null),
      );
  }
}

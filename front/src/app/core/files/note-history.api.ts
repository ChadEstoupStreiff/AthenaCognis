import { inject, Injectable } from '@angular/core';
import { encodeFileSegment } from '@domain/files';
import { ApiClient, backendUrl } from '../api/api-client';

/** Saved version of a note. */
export interface NoteSnapshot {
  readonly id: string;
  readonly createdAt: Date;
  readonly size: number;
}

/** Snapshot as returned by the backend. */
interface BackendSnapshot {
  readonly id: string;
  readonly created_at: string;
  readonly size: number;
}

/**
 * Map a backend snapshot.
 *
 * @param snapshot - Backend snapshot.
 * @returns Snapshot.
 */
function toSnapshot(snapshot: BackendSnapshot): NoteSnapshot {
  return { id: snapshot.id, createdAt: new Date(snapshot.created_at), size: snapshot.size };
}

/** Note versions (`/note-history`). */
@Injectable({ providedIn: 'root' })
export class NoteHistoryApi {
  private readonly api = inject(ApiClient);

  /**
   * Save the current note as a version (the backend skips unchanged or too recent ones).
   *
   * @param path - Note path.
   * @param force - Ignore the minimum interval.
   */
  async snapshot(path: string, force = false): Promise<void> {
    await this.api.post(
      backendUrl(`/note-history/snapshot/${encodeFileSegment(path)}`),
      undefined,
      {
        params: { force },
        silent: true,
      },
    );
  }

  /**
   * Versions of a note.
   *
   * @param path - Note path.
   * @returns Snapshots, newest first.
   */
  async list(path: string): Promise<NoteSnapshot[]> {
    const snapshots = await this.api.get<BackendSnapshot[]>(
      backendUrl(`/note-history/list/${encodeFileSegment(path)}`),
    );
    return snapshots.map(toSnapshot);
  }

  /**
   * Content of a version.
   *
   * @param path - Note path.
   * @param id - Snapshot id.
   * @returns Content.
   */
  async read(path: string, id: string): Promise<string> {
    const result = await this.api.get<{ content: string }>(
      backendUrl(`/note-history/read/${encodeFileSegment(path)}`),
      { params: { snapshot_id: id } },
    );
    return result.content;
  }
}

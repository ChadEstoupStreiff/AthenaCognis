import { inject, Injectable } from '@angular/core';
import { encodeFileSegment } from '@domain/files';
import { ApiClient, backendUrl } from '../api/api-client';

/** Loaded preview. */
export type PreviewResult =
  | { readonly kind: 'image'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' };

const NOT_FOUND = 404;
const REQUEST_DEDUP_MS = 300_000;

/** Backend thumbnails (`/preview/{file}`), generated on demand for visible files. */
@Injectable({ providedIn: 'root' })
export class Previews {
  private readonly api = inject(ApiClient);
  private readonly requested = new Map<string, number>();

  /**
   * Load the preview of a file, queuing its generation when missing.
   *
   * @param path - Shared path.
   * @returns Preview, `pending` when generation was queued.
   */
  async load(path: string): Promise<PreviewResult> {
    const response = await fetch(backendUrl(`/preview/${encodeFileSegment(path)}`));
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      return type.startsWith('text/')
        ? { kind: 'text', text: await response.text() }
        : { kind: 'image', blob: await response.blob() };
    }
    if (response.status === NOT_FOUND && (await this.queue(path))) {
      return { kind: 'pending' };
    }
    return { kind: 'none' };
  }

  /**
   * Ask for a preview (at most once per file every five minutes).
   *
   * @param path - Shared path.
   * @returns `true` when generation is queued.
   */
  async queue(path: string): Promise<boolean> {
    const now = Date.now();
    if (now - (this.requested.get(path) ?? 0) < REQUEST_DEDUP_MS) {
      return true;
    }
    this.requested.set(path, now);
    try {
      await this.api.post(backendUrl(`/preview/generate/${encodeFileSegment(path)}`), undefined, {
        silent: true,
      });
      return true;
    } catch {
      return false;
    }
  }
}

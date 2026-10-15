import { inject, Injectable } from '@angular/core';
import type { JobState, JobTask } from '@domain/contracts';
import { encodeFileSegment } from '@domain/files';
import { ApiClient, backendUrl } from '../api/api-client';
import { latestRuns } from '../jobs/jobs-overview';

/** Loaded preview. */
export type PreviewResult =
  | { readonly kind: 'image'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' };

const NOT_FOUND = 404;
const OPEN_STATES: ReadonlySet<JobState> = new Set(['PENDING', 'IN_PROGRESS']);
/** Task result of a file type the backend can't preview. */
const UNSUPPORTED_RESULT = 'unsupported';

/**
 * Whether a finished run means asking again is pointless (it failed, or nothing to preview).
 *
 * @param run - Latest preview run.
 * @returns `true` when the preview must not be requested again automatically.
 */
function isFinal(run: JobTask): boolean {
  return run.state === 'FAILED' || (run.state === 'COMPLETED' && run.result === UNSUPPORTED_RESULT);
}

/** Backend thumbnails (`/preview/{file}`), generated on demand for visible files. */
@Injectable({ providedIn: 'root' })
export class Previews {
  private readonly api = inject(ApiClient);

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
   * Ask for a missing preview, unless one is already queued or the last run was final.
   *
   * @param path - Shared path.
   * @returns `true` while generation is queued or running.
   */
  async queue(path: string): Promise<boolean> {
    try {
      const latest = await this.latestRun(path);
      if (latest !== null && OPEN_STATES.has(latest.state)) {
        return true;
      }
      if (latest !== null && isFinal(latest)) {
        return false;
      }
      await this.api.post(backendUrl(`/preview/generate/${encodeFileSegment(path)}`), undefined, {
        silent: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Latest preview run of a file.
   *
   * @param path - Shared path.
   * @returns The run, or `null` when never requested.
   */
  private async latestRun(path: string): Promise<JobTask | null> {
    const tasks = await this.api.get<JobTask[]>(
      backendUrl(`/preview/tasks/${encodeFileSegment(path)}`),
      { silent: true },
    );
    return latestRuns(tasks)[0] ?? null;
  }
}

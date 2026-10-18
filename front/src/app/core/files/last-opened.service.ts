import { Injectable, signal } from '@angular/core';

/** Last file opened in the viewer during this session. */
@Injectable({ providedIn: 'root' })
export class LastOpenedService {
  /** Shared path, or `null` before any file is opened. */
  readonly path = signal<string | null>(null);

  /**
   * Remember a file opened in the viewer.
   *
   * @param path - Shared path.
   */
  record(path: string): void {
    this.path.set(path);
  }
}

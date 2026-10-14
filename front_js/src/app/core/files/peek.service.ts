import { Injectable, signal } from '@angular/core';

/** Quick Look drawer state (one file at a time, app-wide). */
@Injectable({ providedIn: 'root' })
export class PeekService {
  /** File shown in the drawer, or `null` when closed. */
  readonly path = signal<string | null>(null);

  /**
   * Open the drawer on a file.
   *
   * @param path - Shared path.
   */
  open(path: string): void {
    this.path.set(path);
  }

  /** Close the drawer. */
  close(): void {
    this.path.set(null);
  }
}

import { Injectable, signal } from '@angular/core';

/** Command palette visibility. */
@Injectable({ providedIn: 'root' })
export class PaletteService {
  /** Whether the palette is open. */
  readonly open = signal(false);

  /** Toggle the palette. */
  toggle(): void {
    this.open.update((value) => !value);
  }
}

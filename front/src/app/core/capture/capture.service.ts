import { Injectable, signal } from '@angular/core';

/** Relations preselected from the page the user is on. */
export interface CaptureDefaults {
  readonly projects: readonly string[];
  readonly tags: readonly string[];
  readonly contacts: readonly string[];
}

/** No preselection. */
export const NO_DEFAULTS: CaptureDefaults = { projects: [], tags: [], contacts: [] };

/** Global capture entry points: upload dialog and voice recorder. */
@Injectable({ providedIn: 'root' })
export class CaptureService {
  /** Upload dialog visibility. */
  readonly uploadOpen = signal(false);
  /** Files waiting in the upload dialog. */
  readonly pendingFiles = signal<readonly File[]>([]);
  /** Voice recorder visibility. */
  readonly voiceOpen = signal(false);
  /** Context defaults (set by pages such as a project or contact page). */
  readonly defaults = signal<CaptureDefaults>(NO_DEFAULTS);

  /**
   * Open the upload dialog, optionally with files.
   *
   * @param files - Dropped or picked files.
   */
  openUpload(files: readonly File[] = []): void {
    this.pendingFiles.update((current) => [...current, ...files]);
    this.uploadOpen.set(true);
  }

  /** Open the voice recorder. */
  openVoice(): void {
    this.voiceOpen.set(true);
  }

  /**
   * Set the defaults applied to new captures (call with {@link NO_DEFAULTS} when leaving).
   *
   * @param defaults - Defaults.
   */
  setDefaults(defaults: CaptureDefaults): void {
    this.defaults.set(defaults);
  }
}

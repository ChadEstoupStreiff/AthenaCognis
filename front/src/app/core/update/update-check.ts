import { computed, inject, Injectable, signal } from '@angular/core';
import type { UpdateStatus } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';

/**
 * Whether GitHub has commits the installed version lacks.
 *
 * @param status - Update check result, `null` before it arrives or when it failed.
 * @returns True when an update is available.
 */
export function isUpdateAvailable(status: UpdateStatus | null): boolean {
  return status !== null && status.behind_by > 0;
}

/** New-version check, run once when the web page opens (dot on Settings, banner on the page). */
@Injectable({ providedIn: 'root' })
export class UpdateCheck {
  private readonly api = inject(ApiClient);
  private readonly status = signal<UpdateStatus | null>(null);

  /** Commits behind GitHub, 0 when up to date or unknown. */
  readonly behindBy = computed(() => this.status()?.behind_by ?? 0);
  /** Whether a new version is available. */
  readonly available = computed(() => isUpdateAvailable(this.status()));

  /** Ask the backend once; a failed check simply shows nothing. */
  constructor() {
    void this.load();
  }

  /** Fetch the status (errors keep the previous value). */
  private async load(): Promise<void> {
    try {
      this.status.set(
        await this.api.get<UpdateStatus>(backendUrl('/update/status'), { silent: true }),
      );
    } catch {
      // Backend unreachable or offline: no update notice.
    }
  }
}

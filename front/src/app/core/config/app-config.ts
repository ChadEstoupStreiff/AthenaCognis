import { Injectable, signal } from '@angular/core';

/** Values from the shared `.env`, written to `/config.json` when the container starts. */
export interface RuntimeConfig {
  readonly userName: string;
  readonly telemetryServerUrl: string;
  readonly telemetryDashboardUrl: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  userName: '',
  telemetryServerUrl: '',
  telemetryDashboardUrl: '',
};

/**
 * Read a string field from untrusted JSON.
 *
 * @param source - Parsed JSON.
 * @param key - Field.
 * @returns The string, or empty.
 */
function stringField(source: Record<string, unknown>, key: keyof RuntimeConfig): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Runtime configuration (`/config.json`). */
@Injectable({ providedIn: 'root' })
export class AppConfig {
  /** Current configuration. */
  readonly value = signal<RuntimeConfig>(DEFAULT_CONFIG);

  /** Load `/config.json` (defaults are kept when it is missing or invalid). */
  async load(): Promise<void> {
    try {
      const response = await fetch('/config.json', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null) {
        const source = body as Record<string, unknown>;
        this.value.set({
          userName: stringField(source, 'userName'),
          telemetryServerUrl: stringField(source, 'telemetryServerUrl'),
          telemetryDashboardUrl: stringField(source, 'telemetryDashboardUrl'),
        });
      }
    } catch {
      // No config file (e.g. plain `ng serve` without one): defaults apply.
    }
  }
}

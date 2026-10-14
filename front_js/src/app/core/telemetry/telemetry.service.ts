import { computed, inject, Injectable } from '@angular/core';
import type { BackendMetrics } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { AppConfig } from '../config/app-config';
import { Logger } from '../logging/logger.service';
import { SettingsStore } from '../settings/settings.store';

const PREFIX = '/telemetry';
const CREATED = 201;
const UNAUTHORIZED = 401;
const CONFLICT = 409;
const HOURS_DECIMALS = 10;
const ISO_DATE_LENGTH = 10;

/** Anonymous daily statistics (same protocol and settings as the Streamlit front: one ping per day overall). */
export interface TelemetryPayload {
  readonly nbr_files: number;
  readonly nbr_projects: number;
  readonly nbr_tags: number;
  readonly nbr_calendars: number;
  readonly nbr_hours: number;
  readonly nbr_summaries: number;
  readonly nbr_links: number;
  readonly nbr_contacts: number;
  readonly nbr_tasks: number;
  readonly nbr_kanban_boards: number;
  readonly nbr_validated_tasks: number;
  readonly files_without_tag: number;
  readonly files_without_project: number;
  readonly disk_files_bytes: number;
}

/**
 * Today's date in UTC (`YYYY-MM-DD`), as the Streamlit front stores it.
 *
 * @returns Date.
 */
export function utcToday(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * Build the anonymous payload from backend metrics.
 *
 * @param metrics - `/metrics` response.
 * @returns Counters only (no names, no content).
 */
export function toTelemetryPayload(metrics: BackendMetrics): TelemetryPayload {
  return {
    nbr_files: metrics.nbr_files,
    nbr_projects: metrics.nbr_projects,
    nbr_tags: metrics.nbr_tags,
    nbr_calendars: metrics.nbr_calendars,
    nbr_hours: Math.round(metrics.nbr_hours * HOURS_DECIMALS) / HOURS_DECIMALS,
    nbr_summaries: metrics.nbr_summaries,
    nbr_links: metrics.nbr_links,
    nbr_contacts: metrics.nbr_contacts,
    nbr_tasks: metrics.nbr_tasks,
    nbr_kanban_boards: metrics.nbr_kanban_boards,
    nbr_validated_tasks: metrics.nbr_validated_tasks,
    files_without_tag: metrics.files_without_tag,
    files_without_project: metrics.files_without_project,
    disk_files_bytes: metrics.disk_usage.files,
  };
}

/** Consent and daily ping. */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly api = inject(ApiClient);
  private readonly config = inject(AppConfig);
  private readonly settings = inject(SettingsStore);
  private readonly logger = inject(Logger);
  private attemptedOn: string | null = null;

  /** Whether a telemetry server is configured in `.env`. */
  readonly configured = computed(() => this.config.value().telemetryServerUrl !== '');
  /** Consent: true, false, or null when not decided yet. */
  readonly consent = computed(() => {
    const value = this.settings.values()['telemetry_enabled'];
    return typeof value === 'boolean' ? value : null;
  });
  /** Whether to ask for consent. */
  readonly needsConsent = computed(
    () => this.configured() && this.settings.snapshot.hasValue() && this.consent() === null,
  );

  /**
   * Store the user's choice (and ping right away when accepted).
   *
   * @param enabled - Accepted.
   */
  async decide(enabled: boolean | null): Promise<void> {
    await this.settings.set('telemetry_enabled', enabled);
  }

  /** Send today's ping when enabled and not sent yet by either front. */
  async pingIfDue(): Promise<void> {
    const today = utcToday();
    if (
      this.attemptedOn === today ||
      !this.configured() ||
      this.consent() !== true ||
      this.settings.values()['telemetry_last_sent'] === today
    ) {
      return;
    }
    this.attemptedOn = today;
    try {
      const metrics = await this.api.get<BackendMetrics>(backendUrl('/metrics'), { silent: true });
      if (await this.send(toTelemetryPayload(metrics))) {
        await this.settings.set('telemetry_last_sent', utcToday());
      }
    } catch (error) {
      this.logger.warn('Telemetry ping failed', error);
    }
  }

  /**
   * Post the payload, renewing the identity once if the server rejects it.
   *
   * @param payload - Counters.
   * @returns Whether the server recorded today's ping.
   */
  private async send(payload: TelemetryPayload): Promise<boolean> {
    let status = await this.post(await this.identity(), payload);
    if (status === UNAUTHORIZED) {
      await this.settings.set('telemetry_uuid', null);
      status = await this.post(await this.identity(true), payload);
    }
    return status === CREATED || status === CONFLICT;
  }

  /**
   * Installation id (stored in settings, requested from the server once).
   *
   * @param renew - Ignore the stored id.
   * @returns UUID.
   * @throws Error when the server gives none.
   */
  private async identity(renew = false): Promise<string> {
    const stored = this.settings.values()['telemetry_uuid'];
    if (!renew && typeof stored === 'string' && stored !== '') {
      return stored;
    }
    const response = await this.api.get<{ uuid?: string }>(`${PREFIX}/uuid`, { silent: true });
    if (typeof response.uuid !== 'string' || response.uuid === '') {
      throw new Error('Telemetry server returned no id.');
    }
    await this.settings.set('telemetry_uuid', response.uuid);
    return response.uuid;
  }

  /**
   * Post counters.
   *
   * @param uuid - Installation id.
   * @param payload - Counters.
   * @returns HTTP status, or null when unreachable.
   */
  private async post(uuid: string, payload: TelemetryPayload): Promise<number | null> {
    try {
      await this.api.post(`${PREFIX}/data/${encodeURIComponent(uuid)}`, payload, { silent: true });
      return CREATED;
    } catch (error) {
      return hasStatus(error, UNAUTHORIZED)
        ? UNAUTHORIZED
        : hasStatus(error, CONFLICT)
          ? CONFLICT
          : null;
    }
  }
}

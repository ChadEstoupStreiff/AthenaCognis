import { computed, inject, Injectable } from '@angular/core';
import type { BackendMetrics } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { AppConfig } from '../config/app-config';
import { Logger } from '../logging/logger.service';
import { SettingsStore } from '../settings/settings.store';
import {
  type FullTelemetryPayload,
  type TelemetryPayload,
  toTelemetryExtras,
  toTelemetryPayload,
} from './telemetry-payload';
import { UsageCounters, type UsageEvent } from './usage-counters';

const PREFIX = '/telemetry';
const CREATED = 201;
const UNAUTHORIZED = 401;
const CONFLICT = 409;
const UNPROCESSABLE = 422;
const ISO_DATE_LENGTH = 10;

/**
 * Today's date in UTC (`YYYY-MM-DD`), as the Streamlit front stores it.
 *
 * @returns Date.
 */
export function utcToday(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * Whether the server recorded the ping (or already had today's).
 *
 * @param status - HTTP status.
 * @returns Recorded.
 */
function isRecorded(status: number | null): boolean {
  return status === CREATED || status === CONFLICT;
}

/** Consent and daily ping. */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly api = inject(ApiClient);
  private readonly config = inject(AppConfig);
  private readonly settings = inject(SettingsStore);
  private readonly logger = inject(Logger);
  private readonly counters = inject(UsageCounters);
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
    if (enabled !== true) {
      this.counters.clear();
    }
    await this.settings.set('telemetry_enabled', enabled);
  }

  /**
   * Count one use of a feature (only with consent; the count, never what was done).
   *
   * @param event - Feature event.
   */
  track(event: UsageEvent): void {
    if (this.configured() && this.consent() === true) {
      this.counters.increment(event);
    }
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
      const usage = await this.api
        .get<unknown>(backendUrl('/usage'), { silent: true })
        .catch(() => null);
      const counts = this.counters.read();
      const base = toTelemetryPayload(metrics);
      const full = {
        ...base,
        ...toTelemetryExtras(usage, counts, this.settings.get('research_subject')),
      };
      const sent = await this.send(full, base);
      if (sent === 'full') {
        this.counters.consume(counts);
      }
      if (sent !== null) {
        await this.settings.set('telemetry_last_sent', utcToday());
      }
    } catch (error) {
      this.logger.warn('Telemetry ping failed', error);
    }
  }

  /**
   * Post the full payload, or the base one to a server predating the extra counters.
   *
   * @param full - Every counter.
   * @param base - Base protocol counters.
   * @returns Payload the server recorded, or null when none.
   */
  private async send(
    full: FullTelemetryPayload,
    base: TelemetryPayload,
  ): Promise<'full' | 'base' | null> {
    const status = await this.postWithIdentity(full);
    if (status === UNPROCESSABLE) {
      return isRecorded(await this.postWithIdentity(base)) ? 'base' : null;
    }
    return isRecorded(status) ? 'full' : null;
  }

  /**
   * Post a payload, renewing the identity once if the server rejects it.
   *
   * @param payload - Counters.
   * @returns HTTP status, or null when unreachable.
   */
  private async postWithIdentity(payload: TelemetryPayload): Promise<number | null> {
    const status = await this.post(await this.identity(), payload);
    if (status !== UNAUTHORIZED) {
      return status;
    }
    await this.settings.set('telemetry_uuid', null);
    return this.post(await this.identity(true), payload);
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
      return [UNAUTHORIZED, CONFLICT, UNPROCESSABLE].find((code) => hasStatus(error, code)) ?? null;
    }
  }
}

import { computed, DestroyRef, inject, Injectable, resource, signal } from '@angular/core';
import type { MailView } from '@domain/contracts';
import { SettingsStore } from '../settings/settings.store';
import { DataSync } from '../state/data-sync.service';
import { latestValue } from '../state/latest-value';
import { MailApi } from './mail.api';

/** Box whose unread mail the navigation badge counts. */
export const MAIL_BADGE_VIEW: MailView = 'inbox';
/** Largest count shown as is; above it the badge reads `99+`. */
export const MAIL_BADGE_MAX = 99;
/** Mail is fetched in the background by the backend: re-read the count this often. */
const MAIL_BADGE_REFRESH_MS = 60_000;

/**
 * Text of the navigation badge.
 *
 * @param count - Unread messages.
 * @returns `null` when nothing is unread, the count, or `99+` above {@link MAIL_BADGE_MAX}.
 */
export function badgeText(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count > MAIL_BADGE_MAX ? `${String(MAIL_BADGE_MAX)}+` : String(count);
}

/** Unread inbox count shown on the Mail entry of the navigation rail (Settings → Mail). */
@Injectable({ providedIn: 'root' })
export class MailBadge {
  private readonly mail = inject(MailApi);
  private readonly settings = inject(SettingsStore);
  private readonly sync = inject(DataSync);
  private readonly tick = signal(0);

  private readonly counts = resource({
    params: () =>
      this.settings.get('mail_nav_badge')
        ? { tick: this.tick(), version: this.sync.version('mail')() }
        : undefined,
    loader: () => this.mail.counts([]),
  });
  private readonly latest = latestValue(this.counts, {});

  /** Badge text, `null` when off or nothing is unread. */
  readonly text = computed(() =>
    this.settings.get('mail_nav_badge') ? badgeText(this.latest()[MAIL_BADGE_VIEW] ?? 0) : null,
  );

  /** Poll the count while the app is open. */
  constructor() {
    const timer = setInterval(() => {
      this.tick.update((value) => value + 1);
    }, MAIL_BADGE_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }
}

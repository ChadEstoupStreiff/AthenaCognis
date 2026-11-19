import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  resource,
  signal,
  untracked,
} from '@angular/core';
import type { MailOutboxItem } from '@domain/contracts';
import { MailApi } from '../../core/mail/mail.api';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';

/** Refresh delay while messages are queued or being sent. */
const OUTBOX_POLL_MS = 3_000;

/**
 * Tell whether some Outbox message still waits for the sender.
 *
 * @param items - Outbox.
 * @returns True when one is queued or being sent.
 */
export function hasPending(items: readonly MailOutboxItem[]): boolean {
  return items.some((item) => item.state !== 'failed');
}

/**
 * Tell whether messages left the Outbox since the previous load (sent or discarded).
 *
 * @param previous - Ids seen before.
 * @param items - Outbox now.
 * @returns True when an id disappeared.
 */
export function someLeft(previous: ReadonlySet<string>, items: readonly MailOutboxItem[]): boolean {
  const current = new Set(items.map((item) => item.id));
  return [...previous].some((id) => !current.has(id));
}

/** Outbox: messages waiting to be sent, refreshed until they reach Sent. */
@Injectable({ providedIn: 'root' })
export class MailOutboxStore {
  private readonly mail = inject(MailApi);
  private readonly sync = inject(DataSync);

  private readonly tick = signal(0);
  private readonly outbox = resource({
    params: () => ({ version: this.sync.version('mail')(), tick: this.tick() }),
    loader: () => this.mail.outbox(),
  });
  /** Outbox, oldest first (kept while reloading). */
  readonly items = latestValue(this.outbox, []);
  /** Messages in the Outbox. */
  readonly count = computed(() => this.items().length);
  /** Messages the server refused. */
  readonly failedCount = computed(
    () => this.items().filter((item) => item.state === 'failed').length,
  );

  private seen: ReadonlySet<string> = new Set();
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Follow each load: refresh mail when messages were sent, poll while some are pending. */
  constructor() {
    effect(() => {
      const items = this.items();
      untracked(() => {
        this.follow(items);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
    });
  }

  /**
   * React to a new Outbox load.
   *
   * @param items - Outbox now.
   */
  private follow(items: readonly MailOutboxItem[]): void {
    const left = someLeft(this.seen, items);
    this.seen = new Set(items.map((item) => item.id));
    clearTimeout(this.timer);
    if (left) {
      this.sync.invalidate('mail');
    }
    if (hasPending(items)) {
      this.timer = setTimeout(() => {
        this.tick.update((value) => value + 1);
      }, OUTBOX_POLL_MS);
    }
  }
}

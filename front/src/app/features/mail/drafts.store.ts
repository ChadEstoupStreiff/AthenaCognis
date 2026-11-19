import { computed, inject, Injectable, resource } from '@angular/core';
import { MailApi } from '../../core/mail/mail.api';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';

/** Drafts box: messages saved from the compose dialog, refetched after each save. */
@Injectable({ providedIn: 'root' })
export class MailDraftsStore {
  private readonly mail = inject(MailApi);
  private readonly sync = inject(DataSync);

  private readonly drafts = resource({
    params: () => ({ version: this.sync.version('mail-drafts')() }),
    loader: () => this.mail.drafts(),
  });
  /** Drafts, last edited first (kept while reloading). */
  readonly items = latestValue(this.drafts, []);
  /** Drafts saved. */
  readonly count = computed(() => this.items().length);
}

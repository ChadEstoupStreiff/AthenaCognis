import { computed, inject, Injectable, resource } from '@angular/core';
import type { MailTrash } from '@domain/contracts';
import { MailApi } from '../../core/mail/mail.api';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';

const EMPTY_TRASH: MailTrash = { retention_days: 30, messages: [], drafts: [] };

/** Trash: deleted mail and drafts, refetched after deletes, restores and syncs (purge). */
@Injectable({ providedIn: 'root' })
export class MailTrashStore {
  private readonly mail = inject(MailApi);
  private readonly sync = inject(DataSync);

  private readonly trash = resource({
    params: () => ({
      trash: this.sync.version('mail-trash')(),
      mail: this.sync.version('mail')(),
    }),
    loader: () => this.mail.trash(),
  });
  /** Trash content (kept while reloading). */
  readonly content = latestValue(this.trash, EMPTY_TRASH);
  /** Items in the Trash. */
  readonly count = computed(() => this.content().messages.length + this.content().drafts.length);
}

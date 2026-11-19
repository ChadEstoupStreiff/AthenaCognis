import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { MailAccount, MailDraft, MailDraftKind } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MailApi } from '../../core/mail/mail.api';
import { NotifyService } from '../../core/notify/notify.service';
import { MailDraftsStore } from './drafts.store';
import { mailTime } from './mail-model';
import { bodyPreview } from './outbox-panel.component';

/** Tag shown for replies and forwards (new messages have none). */
const KIND_LABEL: Readonly<Record<MailDraftKind, string | null>> = {
  new: null,
  reply: 'Reply',
  forward: 'Forward',
};

/** Drafts box: saved messages, opened again in the compose dialog or deleted. */
@Component({
  selector: 'ac-mail-drafts',
  imports: [ButtonModule, TagModule, TooltipModule],
  template: `
    @if (store.items().length === 0) {
      <p class="ac-muted empty">No drafts. Close a message without sending to keep it here.</p>
    }
    <ul class="rows">
      @for (item of store.items(); track item.id) {
        <li>
          <button type="button" class="open" (click)="openDraft.emit(item)">
            <div class="head">
              <span class="to">To: {{ item.to.join(', ') || '(no recipient)' }}</span>
              @if (kindLabel[item.kind]; as label) {
                <p-tag [value]="label" severity="secondary" />
              }
              <span class="time ac-muted">{{ mailTime(item.updated) }}</span>
            </div>
            <div class="subject">{{ item.subject || '(no subject)' }}</div>
            <div class="body ac-muted">{{ bodyPreview(item.body) }}</div>
          </button>
          <div class="foot">
            <span class="ac-muted">From {{ accountEmail(item.account_id) }}</span>
            <span class="actions">
              <p-button
                label="Edit"
                icon="pi pi-pencil"
                size="small"
                [outlined]="true"
                (onClick)="openDraft.emit(item)"
              />
              <p-button
                icon="pi pi-trash"
                severity="danger"
                size="small"
                [text]="true"
                pTooltip="Move to Trash"
                ariaLabel="Delete draft"
                (onClick)="remove(item)"
              />
            </span>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .empty {
      margin: 8px 0;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    li {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      border: 1px solid var(--ac-panel-border);
      border-radius: 10px;
    }
    .open {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .head,
    .foot {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .to {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .time,
    .foot {
      font-size: 12px;
    }
    .subject {
      font-weight: 600;
    }
    .body {
      font-size: 13px;
    }
    .actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailDraftsComponent {
  private readonly mail = inject(MailApi);
  private readonly notify = inject(NotifyService);
  protected readonly store = inject(MailDraftsStore);

  /** Accounts (to show the sending address). */
  readonly accounts = input.required<MailAccount[]>();
  /** Draft to resume in the compose dialog. */
  readonly openDraft = output<MailDraft>();

  protected readonly kindLabel = KIND_LABEL;
  protected readonly mailTime = mailTime;
  protected readonly bodyPreview = bodyPreview;
  private readonly emails = computed(
    () => new Map(this.accounts().map((account) => [account.id, account.email])),
  );

  /**
   * Address of an account.
   *
   * @param accountId - Account id.
   * @returns Email, empty when unknown.
   */
  protected accountEmail(accountId: string): string {
    return this.emails().get(accountId) ?? '';
  }

  /**
   * Move a draft to the Trash (restorable from there).
   *
   * @param item - Draft.
   */
  protected async remove(item: MailDraft): Promise<void> {
    await this.mail.deleteDraft(item.id);
    this.notify.info('Draft moved to Trash', item.subject || '(no subject)');
  }
}

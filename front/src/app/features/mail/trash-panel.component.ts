import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { MailAccount, MailDraft, MailSummary } from '@domain/contracts';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MailApi } from '../../core/mail/mail.api';
import { NotifyService } from '../../core/notify/notify.service';
import { mailTime, senderLabel, trashDaysLeft } from './mail-model';
import { bodyPreview } from './outbox-panel.component';
import { MailTrashStore } from './trash.store';

/** Trash: deleted mail and drafts, restored in one click until purged. */
@Component({
  selector: 'ac-mail-trash',
  imports: [ButtonModule, TagModule, TooltipModule],
  template: `
    @if (store.count() === 0) {
      <p class="ac-muted empty">Trash is empty.</p>
    } @else {
      <div class="toolbar">
        <p-button
          label="Empty trash"
          icon="pi pi-trash"
          severity="danger"
          size="small"
          [outlined]="true"
          (onClick)="empty()"
        />
      </div>
    }
    <ul class="rows">
      @for (item of store.content().messages; track item.id) {
        <li>
          <div class="head">
            <i class="pi pi-envelope ac-muted" title="Mail"></i>
            <span class="who">{{ messageWho(item) }}</span>
            <span class="time ac-muted">{{ mailTime(item.date) }}</span>
          </div>
          <div class="subject">{{ item.subject || '(no subject)' }}</div>
          <div class="body ac-muted">{{ item.snippet }}</div>
          <div class="foot">
            <span class="ac-muted">{{ accountEmail(item.account_id) }}</span>
            <p-tag [value]="leftLabel(item.trashed_at)" severity="secondary" />
            <p-button
              label="Restore"
              icon="pi pi-replay"
              size="small"
              [outlined]="true"
              class="restore"
              pTooltip="Back to its mailbox"
              (onClick)="restoreMessage(item)"
            />
          </div>
        </li>
      }
      @for (item of store.content().drafts; track item.id) {
        <li>
          <div class="head">
            <i class="pi pi-file-edit ac-muted" title="Draft"></i>
            <span class="who">Draft to: {{ item.to.join(', ') || '(no recipient)' }}</span>
            <span class="time ac-muted">{{ mailTime(item.updated) }}</span>
          </div>
          <div class="subject">{{ item.subject || '(no subject)' }}</div>
          <div class="body ac-muted">{{ bodyPreview(item.body) }}</div>
          <div class="foot">
            <span class="ac-muted">{{ accountEmail(item.account_id) }}</span>
            <p-tag [value]="leftLabel(item.trashed_at)" severity="secondary" />
            <p-button
              label="Restore"
              icon="pi pi-replay"
              size="small"
              [outlined]="true"
              class="restore"
              pTooltip="Back to Drafts"
              (onClick)="restoreDraft(item)"
            />
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .empty {
      margin: 8px 0;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 8px;
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
    .head,
    .foot {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .who {
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
      overflow: hidden;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .restore {
      margin-left: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailTrashComponent {
  private readonly mail = inject(MailApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  protected readonly store = inject(MailTrashStore);

  /** Accounts (to show the receiving or sending address). */
  readonly accounts = input.required<MailAccount[]>();

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
   * Who a deleted message is from (received) or to (sent).
   *
   * @param item - Message.
   * @returns Label.
   */
  protected messageWho(item: MailSummary): string {
    return item.mailbox === 'sent' ? `To: ${item.recipients}` : senderLabel(item);
  }

  /**
   * Time left before an item is removed for good.
   *
   * @param trashedAt - Deletion time, naive UTC.
   * @returns Label such as "12 days left".
   */
  protected leftLabel(trashedAt: string | null): string {
    if (trashedAt === null) {
      return '';
    }
    const days = trashDaysLeft(trashedAt, this.store.content().retention_days);
    if (days === 0) {
      return 'Removed soon';
    }
    return days === 1 ? '1 day left' : `${String(days)} days left`;
  }

  /**
   * Put a message back in its mailbox.
   *
   * @param item - Message.
   */
  protected async restoreMessage(item: MailSummary): Promise<void> {
    await this.mail.restoreMessage(item.id);
    this.notify.success('Mail restored', item.subject || '(no subject)');
  }

  /**
   * Put a draft back in Drafts.
   *
   * @param item - Draft.
   */
  protected async restoreDraft(item: MailDraft): Promise<void> {
    await this.mail.restoreDraft(item.id);
    this.notify.success('Draft restored', item.subject || '(no subject)');
  }

  /** Remove every item for good after confirmation. */
  protected empty(): void {
    this.confirm.confirm({
      header: 'Empty trash',
      message: `Remove ${String(this.store.count())} items for good? This cannot be undone.`,
      acceptButtonProps: { label: 'Empty trash', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.mail.emptyTrash(),
    });
  }
}

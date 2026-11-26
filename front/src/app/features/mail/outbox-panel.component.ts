import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { MailAccount, MailOutboxItem, OutboxState } from '@domain/contracts';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MailApi } from '../../core/mail/mail.api';
import { mailTime } from './mail-model';
import { MailOutboxStore } from './outbox.store';

const BODY_PREVIEW_CHARS = 140;

/** Label and tag severity of each Outbox state. */
const STATE_META: Readonly<
  Record<OutboxState, { readonly label: string; readonly severity: 'info' | 'warn' | 'danger' }>
> = {
  queued: { label: 'Queued', severity: 'info' },
  sending: { label: 'Sending…', severity: 'warn' },
  failed: { label: 'Failed', severity: 'danger' },
};

/**
 * First characters of a body, on one line.
 *
 * @param body - Written text.
 * @returns Preview.
 */
export function bodyPreview(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > BODY_PREVIEW_CHARS ? `${line.slice(0, BODY_PREVIEW_CHARS)}…` : line;
}

/** Outbox: mail waiting to be sent, failed mail with its error, retry and discard. */
@Component({
  selector: 'ac-mail-outbox',
  imports: [ButtonModule, TagModule, TooltipModule],
  template: `
    @if (store.items().length === 0) {
      <p class="ac-muted empty">Nothing waiting. Sent mail moves to Sent.</p>
    }
    <ul class="rows">
      @for (item of store.items(); track item.id) {
        <li [class.failed]="item.state === 'failed'">
          <div class="head">
            <span class="to">To: {{ item.to.join(', ') }}</span>
            <p-tag
              [value]="stateMeta[item.state].label"
              [severity]="stateMeta[item.state].severity"
            />
            <span class="time ac-muted">{{ mailTime(item.created) }}</span>
          </div>
          <div class="subject">{{ item.subject || '(no subject)' }}</div>
          <div class="body ac-muted">{{ bodyPreview(item.body) }}</div>
          <div class="foot">
            <span class="ac-muted">From {{ accountEmail(item.account_id) }}</span>
            @if (item.error) {
              <span class="error">{{ item.error }}</span>
            }
            <span class="actions">
              @if (item.state === 'failed') {
                <p-button
                  label="Retry"
                  icon="pi pi-refresh"
                  size="small"
                  [outlined]="true"
                  (onClick)="retry(item)"
                />
              }
              @if (item.state !== 'sending') {
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  size="small"
                  [text]="true"
                  pTooltip="Discard (not sent)"
                  ariaLabel="Discard"
                  (onClick)="discard(item)"
                />
              }
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
    li.failed {
      border-color: var(--p-red-400, #f87171);
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
      font-size: calc(12px * var(--ac-font-scale));
    }
    .subject {
      font-weight: 600;
    }
    .body {
      font-size: calc(13px * var(--ac-font-scale));
    }
    .error {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--p-red-500, #ef4444);
    }
    .actions {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailOutboxComponent {
  private readonly mail = inject(MailApi);
  private readonly confirm = inject(ConfirmationService);
  protected readonly store = inject(MailOutboxStore);

  /** Accounts (to show the sending address). */
  readonly accounts = input.required<MailAccount[]>();

  protected readonly stateMeta = STATE_META;
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
   * Queue a failed message again.
   *
   * @param item - Outbox message.
   */
  protected retry(item: MailOutboxItem): void {
    void this.mail.retryOutgoing(item.id);
  }

  /**
   * Remove a message from the Outbox after confirmation.
   *
   * @param item - Outbox message.
   */
  protected discard(item: MailOutboxItem): void {
    this.confirm.confirm({
      header: 'Discard message',
      message: `Discard "${item.subject || '(no subject)'}"? It will not be sent.`,
      acceptButtonProps: { label: 'Discard', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.mail.discardOutgoing(item.id),
    });
  }
}

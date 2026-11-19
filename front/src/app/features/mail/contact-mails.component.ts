import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MailApi } from '../../core/mail/mail.api';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { mailTime } from './mail-model';

const CONTACT_MAIL_LIMIT = 100;

/** Mail received from one People contact (its address and senders linked to it). */
@Component({
  selector: 'ac-contact-mails',
  imports: [RouterLink, EmptyStateComponent],
  template: `
    @if (rows().length > 0) {
      <ul class="rows" aria-label="Mail from this contact">
        @for (row of rows(); track row.id) {
          <li>
            <a
              class="row"
              [class.unread]="!row.is_read"
              routerLink="/mail"
              [queryParams]="{ open: row.id }"
            >
              <span
                class="bar"
                [style.background]="colorOf(row.account_id)"
                aria-hidden="true"
              ></span>
              <span class="main">
                <span class="top">
                  <span class="subject">{{ row.subject || '(no subject)' }}</span>
                  @if (row.needs_reply) {
                    <i class="pi pi-reply reply" title="Needs a reply"></i>
                  }
                  @if (row.has_attachments) {
                    <i class="pi pi-paperclip ac-muted" title="Attachments"></i>
                  }
                  <time class="ac-muted">{{ mailTime(row.date) }}</time>
                </span>
                <span class="snippet ac-muted">{{ row.summary ?? row.snippet }}</span>
                <small class="ac-muted">{{ row.sender_email }}</small>
              </span>
            </a>
          </li>
        }
      </ul>
    } @else {
      <ac-empty-state
        icon="pi pi-envelope"
        [title]="mails.isLoading() ? 'Loading…' : 'No mail from this contact'"
        message="Mail sent from their address, or from senders linked to them in Mail → Senders."
      />
    }
  `,
  styles: `
    .rows {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: flex;
      gap: 10px;
      padding: 8px;
      border-radius: 10px;
      color: inherit;
      text-decoration: none;
      &:hover {
        background: var(--p-content-hover-background);
      }
      &.unread .subject {
        font-weight: 700;
      }
    }
    .bar {
      flex: none;
      align-self: stretch;
      width: 4px;
      border-radius: 2px;
    }
    .main {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 6px;
      time {
        flex: none;
        margin-left: auto;
        font-size: 12px;
      }
    }
    .subject,
    .snippet {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .snippet {
      font-size: 13px;
    }
    .reply {
      color: var(--p-primary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactMailsComponent {
  private readonly mail = inject(MailApi);
  private readonly sync = inject(DataSync);

  /** People contact id. */
  readonly contactId = input.required<string>();

  protected readonly mailTime = mailTime;
  protected readonly mails = resource({
    params: () => ({ contactId: this.contactId(), version: this.sync.version('mail')() }),
    loader: ({ params }) =>
      this.mail.messages({
        view: 'all',
        accountId: null,
        search: '',
        sender: null,
        contactId: params.contactId,
        limit: CONTACT_MAIL_LIMIT,
      }),
  });
  private readonly accounts = resource({
    params: () => ({ version: this.sync.version('mail')() }),
    loader: () => this.mail.accounts(),
  });
  protected readonly rows = latestValue(this.mails, []);
  private readonly colors = computed(
    () =>
      new Map(
        (this.accounts.hasValue() ? this.accounts.value() : []).map((account) => [
          account.id,
          account.color,
        ]),
      ),
  );

  /**
   * Color of an account.
   *
   * @param accountId - Account id.
   * @returns `#rrggbb`, transparent when unknown.
   */
  protected colorOf(accountId: string): string {
    return this.colors().get(accountId) ?? 'transparent';
  }
}

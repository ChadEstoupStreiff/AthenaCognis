import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import type { MailAccount } from '@domain/contracts';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { MailApi } from '../../../core/mail/mail.api';
import { NotifyService } from '../../../core/notify/notify.service';
import { DataSync } from '../../../core/state/data-sync.service';
import { latestValue } from '../../../core/state/latest-value';
import { MailAccountDialogComponent } from '../../mail/account-dialog.component';

/** Mail accounts block of the Mail settings card: connect, edit, remove. */
@Component({
  selector: 'ac-mail-accounts',
  host: { id: 'mail-accounts' },
  imports: [ButtonModule, TooltipModule, MailAccountDialogComponent],
  template: `
    <div class="heading">
      <h3>Accounts</h3>
      <p-button
        label="Connect account"
        icon="pi pi-plus"
        size="small"
        [outlined]="true"
        (onClick)="dialog.set({ account: null })"
      />
    </div>
    <div class="account-list">
      @for (account of accounts(); track account.id) {
        <div class="row">
          <div class="inline grow">
            <span class="account-bar" [style.background]="account.color" aria-hidden="true"></span>
            <div class="label">
              <strong>{{ account.label || account.email }}</strong>
              <small class="ac-muted">
                {{ account.email }} · {{ account.protocol.toUpperCase() }} · last sync
                {{ account.last_sync ?? 'never' }}
              </small>
              @if (account.last_error) {
                <small class="error"
                  ><i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                  {{ account.last_error }}</small
                >
              }
            </div>
          </div>
          <div class="inline">
            <p-button
              icon="pi pi-pencil"
              [text]="true"
              severity="secondary"
              pTooltip="Edit account"
              ariaLabel="Edit account"
              (onClick)="dialog.set({ account })"
            />
            <p-button
              icon="pi pi-trash"
              [text]="true"
              severity="danger"
              pTooltip="Remove account"
              ariaLabel="Remove account"
              (onClick)="remove(account)"
            />
          </div>
        </div>
      } @empty {
        <p class="ac-muted intro">No account connected.</p>
      }
    </div>
    @if (dialog(); as open) {
      <ac-mail-account-dialog
        [visible]="true"
        (visibleChange)="$event || dialog.set(null)"
        [account]="open.account"
        (saved)="fetch($event)"
      />
    }
  `,
  styleUrl: './section.scss',
  styles: `
    :host {
      display: block;
      margin-bottom: 12px;
      scroll-margin-top: 16px;
    }
    h3 {
      margin: 0;
      font-size: 14px;
    }
    .account-bar {
      flex: none;
      align-self: stretch;
      width: 4px;
      border-radius: 2px;
    }
    .error {
      color: var(--p-orange-500);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailAccountsComponent {
  private readonly mail = inject(MailApi);
  private readonly sync = inject(DataSync);
  private readonly confirm = inject(ConfirmationService);
  private readonly notify = inject(NotifyService);

  protected readonly dialog = signal<{ account: MailAccount | null } | null>(null);
  private readonly accountsResource = resource({
    params: () => ({ version: this.sync.version('mail')() }),
    loader: () => this.mail.accounts(),
  });
  protected readonly accounts = latestValue(this.accountsResource, []);

  /**
   * Fetch the mail of a saved account, reporting errors only.
   *
   * @param account - Saved account.
   */
  protected async fetch(account: MailAccount): Promise<void> {
    const results = await this.mail.syncNow([account.id]);
    const failed = results.filter((result) => result.error !== null);
    if (failed.length > 0) {
      this.notify.error('Mail sync failed', failed.map((result) => result.error).join('\n'));
    }
  }

  /**
   * Ask before removing an account.
   *
   * @param account - Account.
   */
  protected remove(account: MailAccount): void {
    this.confirm.confirm({
      header: 'Remove mail account',
      message: `Remove ${account.email}? Its messages are deleted here (not on the server).`,
      acceptButtonProps: { label: 'Remove', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.mail.deleteAccount(account.id),
    });
  }
}

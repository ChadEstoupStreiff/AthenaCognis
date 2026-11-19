import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SenderFlag } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { MailApi } from '../../core/mail/mail.api';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';
import { FLAG_META, mailTime } from './mail-model';

const SEARCH_DEBOUNCE_MS = 250;

/** Senders with their treatment: flag people VIP, mute or block them. */
@Component({
  selector: 'ac-mail-senders',
  imports: [
    FormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectButtonModule,
    TooltipModule,
  ],
  template: `
    <div class="head">
      <p-iconfield>
        <p-inputicon class="pi pi-search" />
        <input
          pInputText
          placeholder="Search senders…"
          [ngModel]="query()"
          (ngModelChange)="search($event)"
          aria-label="Search senders"
        />
      </p-iconfield>
      <p-selectbutton
        [options]="filterOptions"
        optionLabel="label"
        optionValue="flag"
        [ngModel]="flag()"
        (ngModelChange)="flag.set($event)"
        [allowEmpty]="true"
        size="small"
        aria-label="Filter by flag"
      />
    </div>
    <ul class="rows">
      @for (sender of senderRows(); track sender.email) {
        <li class="row">
          <button type="button" class="who" (click)="openMails.emit(sender.email)">
            <strong>{{ sender.name || sender.email }}</strong>
            <small class="ac-muted">
              {{ sender.email }} · {{ sender.message_count }} mails
              @if (sender.unread_count) {
                · {{ sender.unread_count }} unread
              }
              @if (sender.last_date) {
                · {{ mailTime(sender.last_date) }}
              }
            </small>
          </button>
          <p-selectbutton
            [options]="flags"
            optionValue="flag"
            [ngModel]="sender.flag"
            (ngModelChange)="setFlag(sender.email, $event)"
            [allowEmpty]="false"
            size="small"
            [attr.aria-label]="'Treatment of ' + sender.email"
          >
            <ng-template #item let-option>
              <i [class]="option.icon" [pTooltip]="option.label + ': ' + option.hint"></i>
            </ng-template>
          </p-selectbutton>
          <p-button
            [icon]="sender.contact_id ? 'pi pi-id-card' : 'pi pi-user-plus'"
            [text]="true"
            size="small"
            [pTooltip]="sender.contact_id ? 'Open in People' : 'Add to People'"
            [ariaLabel]="sender.contact_id ? 'Open in People' : 'Add to People'"
            (onClick)="openContact.emit(sender.email)"
          />
        </li>
      } @empty {
        <li class="ac-muted empty">{{ senders.isLoading() ? 'Loading…' : 'No sender.' }}</li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      p-iconfield {
        flex: 1;
        min-width: 200px;
      }
      input {
        width: 100%;
      }
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
      overflow-y: auto;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 10px;
      &:hover {
        background: var(--p-content-hover-background);
      }
    }
    .who {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      strong,
      small {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
    .empty {
      padding: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendersPanelComponent {
  private readonly mail = inject(MailApi);
  private readonly sync = inject(DataSync);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Emits a sender whose mails should be listed. */
  readonly openMails = output<string>();
  /** Emits a sender to open in People. */
  readonly openContact = output<string>();

  protected readonly flags = [...FLAG_META];
  protected readonly filterOptions = FLAG_META.filter((meta) => meta.flag !== 'normal');
  protected readonly mailTime = mailTime;
  protected readonly query = signal('');
  private readonly debouncedQuery = signal('');
  protected readonly flag = signal<SenderFlag | null>(null);

  protected readonly senders = resource({
    params: () => ({
      flag: this.flag(),
      search: this.debouncedQuery(),
      version: this.sync.version('mail')(),
    }),
    loader: ({ params }) => this.mail.senders(params.flag, params.search),
  });

  protected readonly senderRows = latestValue(this.senders, []);

  /**
   * Debounce the search.
   *
   * @param value - Text.
   */
  protected search(value: string): void {
    this.query.set(value);
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.debouncedQuery.set(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Change how a sender is treated.
   *
   * @param email - Address.
   * @param flag - New flag.
   */
  protected async setFlag(email: string, flag: SenderFlag): Promise<void> {
    await this.mail.updateSender(email, { flag });
  }
}

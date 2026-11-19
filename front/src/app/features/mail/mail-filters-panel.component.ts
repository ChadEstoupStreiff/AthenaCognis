import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { MailCategory } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { EMPTY_FILTERS, type MailFilters, reversedDates, type TriState } from './mail-filters';

const CATEGORY_OPTIONS: readonly { readonly value: MailCategory | null; readonly label: string }[] =
  [
    { value: null, label: 'Any' },
    { value: 'person', label: 'People' },
    { value: 'newsletter', label: 'Newsletters' },
    { value: 'notification', label: 'Notifications' },
  ];
const UNREAD_OPTIONS: readonly { readonly value: TriState; readonly label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'yes', label: 'Unread' },
  { value: 'no', label: 'Read' },
];
const ATTACHMENT_OPTIONS: readonly { readonly value: TriState; readonly label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'yes', label: 'With files' },
  { value: 'no', label: 'Without' },
];

/** Search filters of the mail list (sender, recipients, dates, category, state, files). */
@Component({
  selector: 'ac-mail-filters-panel',
  imports: [FormsModule, ButtonModule, InputTextModule, SelectModule, SelectButtonModule],
  template: `
    <form class="filters" (ngSubmit)="$event.preventDefault()">
      <label class="field">
        <span>From</span>
        <input
          pInputText
          name="from"
          placeholder="Name or address"
          [ngModel]="filters().fromText"
          (change)="patch({ fromText: text($event) })"
        />
      </label>
      <label class="field">
        <span>To / Cc</span>
        <input
          pInputText
          name="to"
          placeholder="Name or address"
          [ngModel]="filters().toText"
          (change)="patch({ toText: text($event) })"
        />
      </label>
      <div class="dates">
        <label class="field">
          <span>From date</span>
          <input
            pInputText
            type="date"
            name="since"
            [ngModel]="filters().since"
            (ngModelChange)="patch({ since: $event ?? '' })"
          />
        </label>
        <label class="field">
          <span>To date</span>
          <input
            pInputText
            type="date"
            name="until"
            [ngModel]="filters().until"
            (ngModelChange)="patch({ until: $event ?? '' })"
          />
        </label>
      </div>
      @if (datesReversed()) {
        <p class="error">The start date is after the end date.</p>
      }
      <label class="field">
        <span>Category</span>
        <p-select
          name="category"
          [options]="categoryOptions"
          optionLabel="label"
          optionValue="value"
          [ngModel]="filters().category"
          (ngModelChange)="patch({ category: $event })"
          [fluid]="true"
          appendTo="body"
        />
      </label>
      <div class="field">
        <span>State</span>
        <p-selectbutton
          name="unread"
          [options]="unreadOptions"
          optionLabel="label"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="filters().unread"
          (ngModelChange)="patch({ unread: $event })"
          size="small"
          ariaLabel="Read state"
        />
      </div>
      <div class="field">
        <span>Attachments</span>
        <p-selectbutton
          name="attachments"
          [options]="attachmentOptions"
          optionLabel="label"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="filters().attachments"
          (ngModelChange)="patch({ attachments: $event })"
          size="small"
          ariaLabel="Attachments"
        />
      </div>
      <p-button
        label="Reset filters"
        icon="pi pi-filter-slash"
        size="small"
        severity="secondary"
        [text]="true"
        (onClick)="filters.set(empty)"
      />
    </form>
  `,
  styles: `
    .filters {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: min(340px, 86vw);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--ac-muted);
    }
    .dates {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    input {
      width: 100%;
    }
    .error {
      margin: 0;
      font-size: 12px;
      color: var(--p-red-500);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailFiltersPanelComponent {
  /** Filters (two-way). */
  readonly filters = model.required<MailFilters>();

  protected readonly empty = EMPTY_FILTERS;
  protected readonly categoryOptions = [...CATEGORY_OPTIONS];
  protected readonly unreadOptions = [...UNREAD_OPTIONS];
  protected readonly attachmentOptions = [...ATTACHMENT_OPTIONS];
  protected readonly datesReversed = computed(() => reversedDates(this.filters()));

  /**
   * Change some filters.
   *
   * @param change - Filters.
   */
  protected patch(change: Partial<MailFilters>): void {
    this.filters.update((filters) => ({ ...filters, ...change }));
  }

  /**
   * Value of a text input event.
   *
   * @param event - Change event.
   * @returns Input value.
   */
  protected text(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : '';
  }
}

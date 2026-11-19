import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import type { MailAddressSuggestion } from '@domain/contracts';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { MailApi } from '../../core/mail/mail.api';
import {
  commitDraft,
  contactNames,
  formatEmailName,
  joinRecipients,
  recipientLabel,
  splitAddresses,
} from './mail-model';

const SEARCH_DELAY_MS = 150;
/** Typed separator that turns the text into pills. */
const COMMIT_SEPARATOR = /[,;]/;
let panelCount = 0;

/**
 * Suggestions not yet among the recipients.
 *
 * @param suggestions - Addresses from the server.
 * @param recipients - Recipients already added.
 * @returns Suggestions without those addresses.
 */
export function freshSuggestions(
  suggestions: readonly MailAddressSuggestion[],
  recipients: readonly string[],
): MailAddressSuggestion[] {
  const present = new Set(recipients.map((address) => address.toLowerCase()));
  return suggestions.filter((suggestion) => !present.has(suggestion.email.toLowerCase()));
}

/**
 * Tell whether typed text should become pills now.
 *
 * @param text - Field text.
 * @returns True after a comma or semicolon, or a space following an address.
 */
export function shouldCommit(text: string): boolean {
  return COMMIT_SEPARATOR.test(text) || (text.endsWith(' ') && text.includes('@'));
}

/** Recipients as removable pills ("Name <email> ×"), suggesting addresses seen in mail. */
@Component({
  selector: 'ac-mail-address-input',
  template: `
    <label class="field">
      @for (email of recipients(); track email) {
        <span class="pill" [title]="email">
          <span class="pill-text">{{ pillText(email) }}</span>
          <button
            type="button"
            class="remove"
            [attr.aria-label]="'Remove ' + email"
            (click)="$event.stopPropagation(); remove(email)"
          >
            <i class="pi pi-times"></i>
          </button>
        </span>
      }
      <input
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-controls]="panelId"
        [attr.aria-label]="label()"
        [attr.aria-expanded]="suggestions().length > 0"
        [value]="draft()"
        (input)="type($any($event.target).value)"
        (keydown)="navigate($event)"
        (blur)="leave()"
      />
    </label>
    @if (suggestions().length > 0) {
      <ul class="panel" role="listbox" [id]="panelId">
        @for (suggestion of suggestions(); track suggestion.email; let index = $index) {
          <li
            role="option"
            [class.active]="index === activeIndex()"
            [attr.aria-selected]="index === activeIndex()"
            (mousedown)="$event.preventDefault(); pick(suggestion)"
            (mouseenter)="activeIndex.set(index)"
          >
            <span class="name">{{ suggestionName(suggestion) }}</span>
            <span class="email ac-muted">{{ suggestion.email }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .field {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      min-height: 38px;
      padding: 4px 8px;
      border: 1px solid var(--p-inputtext-border-color, var(--ac-panel-border));
      border-radius: var(--p-inputtext-border-radius, 6px);
      background: var(--p-inputtext-background, transparent);
      color: var(--p-inputtext-color, inherit);
      cursor: text;
    }
    .field:focus-within {
      border-color: var(--p-inputtext-focus-border-color, var(--p-primary-color));
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      padding: 2px 4px 2px 10px;
      border-radius: 999px;
      background: var(--p-highlight-background, rgb(59 130 246 / 15%));
      color: var(--p-highlight-color, inherit);
      font-size: 13px;
    }
    .pill-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .remove {
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: none;
      color: inherit;
      cursor: pointer;
      i {
        font-size: 10px;
      }
    }
    .remove:hover {
      background: rgb(0 0 0 / 12%);
    }
    input {
      flex: 1;
      min-width: 140px;
      padding: 4px 0;
      border: none;
      outline: none;
      background: none;
      color: inherit;
      font: inherit;
    }
    .panel {
      position: absolute;
      z-index: 10;
      top: calc(100% + 2px);
      left: 0;
      right: 0;
      max-height: 240px;
      margin: 0;
      padding: 4px;
      overflow-y: auto;
      list-style: none;
      border: 1px solid var(--ac-panel-border);
      border-radius: 8px;
      background: var(--p-content-background, var(--ac-panel-bg, #fff));
      box-shadow: 0 6px 18px rgb(0 0 0 / 18%);
    }
    li {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    li.active {
      background: var(--p-highlight-background, rgb(59 130 246 / 15%));
    }
    .name {
      font-weight: 500;
    }
    .email {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailAddressInputComponent {
  private readonly mail = inject(MailApi);
  private readonly catalog = inject(CatalogStore);

  /** Recipient list, comma separated (two-way). */
  readonly value = model('');
  /** Accessible name. */
  readonly label = input('Recipients');

  protected readonly recipients = computed(() => splitAddresses(this.value()));
  protected readonly draft = signal('');
  protected readonly suggestions = signal<MailAddressSuggestion[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly panelId = `ac-address-panel-${++panelCount}`;
  private readonly names = computed(() => contactNames(this.catalog.contactList()));
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request = 0;

  /**
   * Pill text of a recipient.
   *
   * @param email - Address.
   * @returns "Name <email>".
   */
  protected pillText(email: string): string {
    return recipientLabel(email, this.contactName(email));
  }

  /**
   * Name shown for a suggestion: People name, name seen in mail, else from the address.
   *
   * @param suggestion - Suggestion.
   * @returns Name.
   */
  protected suggestionName(suggestion: MailAddressSuggestion): string {
    return (
      this.contactName(suggestion.email) || suggestion.name || formatEmailName(suggestion.email)
    );
  }

  /**
   * Store the typed text, turn finished addresses into pills, look up suggestions.
   *
   * @param text - Field text.
   */
  protected type(text: string): void {
    this.draft.set(text);
    if (shouldCommit(text)) {
      this.commit();
    }
    clearTimeout(this.timer);
    const search = this.draft().trim();
    if (search === '') {
      this.close();
      return;
    }
    this.timer = setTimeout(() => void this.lookUp(search), SEARCH_DELAY_MS);
  }

  /**
   * Keys: arrows move, Enter/Tab pick or add, Backspace removes the last pill, Escape closes.
   *
   * @param event - Key event.
   */
  protected navigate(event: KeyboardEvent): void {
    const last = this.recipients().at(-1);
    if (event.key === 'Backspace' && this.draft() === '' && last !== undefined) {
      this.remove(last);
      return;
    }
    if (this.suggestions().length > 0 && this.navigateList(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && this.draft().trim() !== '') {
      event.preventDefault();
      this.commit();
    }
  }

  /**
   * Remove a recipient.
   *
   * @param email - Address.
   */
  protected remove(email: string): void {
    this.setRecipients(this.recipients().filter((recipient) => recipient !== email));
  }

  /**
   * Add a suggestion as a pill.
   *
   * @param suggestion - Chosen address.
   */
  protected pick(suggestion: MailAddressSuggestion): void {
    this.setRecipients(commitDraft(this.recipients(), suggestion.email).recipients);
    this.draft.set('');
    this.close();
  }

  /** On blur: add what was typed and hide the suggestions. */
  protected leave(): void {
    this.commit();
    this.close();
  }

  /**
   * Handle a key in the open suggestion list.
   *
   * @param event - Key event.
   * @returns True when the key was used.
   */
  private navigateList(event: KeyboardEvent): boolean {
    const count = this.suggestions().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex.update((index) => (index + step + count) % count);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = this.suggestions().at(this.activeIndex());
      if (chosen !== undefined) {
        this.pick(chosen);
      }
      return true;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
      return true;
    }
    return false;
  }

  /** Turn the typed addresses into pills, keeping text that is not an address. */
  private commit(): void {
    const { recipients, rest } = commitDraft(this.recipients(), this.draft());
    this.setRecipients(recipients);
    this.draft.set(rest);
  }

  /**
   * Write the recipients back to the two-way value.
   *
   * @param recipients - Addresses.
   */
  private setRecipients(recipients: readonly string[]): void {
    this.value.set(joinRecipients(recipients));
  }

  /**
   * People name of an address.
   *
   * @param email - Address.
   * @returns Name, empty when no contact matches.
   */
  private contactName(email: string): string {
    return this.names().get(email.toLowerCase()) ?? '';
  }

  /** Hide the suggestions (and drop pending lookups). */
  private close(): void {
    clearTimeout(this.timer);
    this.request += 1;
    this.suggestions.set([]);
  }

  /**
   * Fetch suggestions, ignoring answers that arrive after a newer lookup.
   *
   * @param search - Text typed.
   */
  private async lookUp(search: string): Promise<void> {
    const request = ++this.request;
    const found = await this.mail.suggestAddresses(search).catch(() => []);
    if (request !== this.request) {
      return;
    }
    this.activeIndex.set(0);
    this.suggestions.set(freshSuggestions(found, this.recipients()));
  }
}

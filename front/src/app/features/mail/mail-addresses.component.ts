import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { NotifyService } from '../../core/notify/notify.service';
import { type MailAddress, parseAddressList } from './mail-model';

const COLLAPSED_COUNT = 6;

/** Address list (From, To, Cc): every address shown, long lists collapsible, click copies. */
@Component({
  selector: 'ac-mail-addresses',
  imports: [TooltipModule],
  template: `
    <span class="label ac-muted">{{ label() }}</span>
    <span class="chips">
      @for (address of visible(); track $index) {
        <button
          type="button"
          class="chip"
          [pTooltip]="address.email + ' · click to copy'"
          (click)="copy(address)"
        >
          {{ address.name || address.email }}
        </button>
      }
      @if (hiddenCount() > 0) {
        <button type="button" class="more" (click)="expanded.set(true)">
          +{{ hiddenCount() }} more
        </button>
      } @else if (expanded() && addresses().length > collapsedCount) {
        <button type="button" class="more" (click)="expanded.set(false)">Show less</button>
      }
    </span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
      font-size: 12px;
    }
    .label {
      flex: none;
      min-width: 28px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 0;
    }
    .chip,
    .more {
      padding: 1px 8px;
      border: 1px solid var(--ac-panel-border);
      border-radius: 999px;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      overflow-wrap: anywhere;
      text-align: left;
    }
    .chip:hover {
      border-color: var(--p-primary-color);
      color: var(--p-primary-color);
    }
    .more {
      border-style: dashed;
      color: var(--p-primary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailAddressesComponent {
  private readonly notify = inject(NotifyService);

  /** Row label (From, To, Cc). */
  readonly label = input.required<string>();
  /** Address header value. */
  readonly value = input.required<string>();

  protected readonly collapsedCount = COLLAPSED_COUNT;
  protected readonly expanded = signal(false);
  protected readonly addresses = computed(() => parseAddressList(this.value()));
  protected readonly visible = computed(() =>
    this.expanded() ? this.addresses() : this.addresses().slice(0, COLLAPSED_COUNT),
  );
  protected readonly hiddenCount = computed(() => this.addresses().length - this.visible().length);

  /**
   * Copy an email address to the clipboard.
   *
   * @param address - Address.
   */
  protected async copy(address: MailAddress): Promise<void> {
    await navigator.clipboard.writeText(address.email);
    this.notify.info('Email copied', address.email);
  }
}

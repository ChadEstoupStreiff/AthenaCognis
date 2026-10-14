import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SaveStatus } from '../../core/state/autosave';

const LABELS: Readonly<Record<SaveStatus, { readonly icon: string; readonly text: string }>> = {
  idle: { icon: '', text: '' },
  pending: { icon: 'pi pi-circle-fill', text: 'Unsaved' },
  saving: { icon: 'pi pi-spin pi-spinner', text: 'Saving…' },
  saved: { icon: 'pi pi-check', text: 'Saved' },
  error: { icon: 'pi pi-exclamation-triangle', text: 'Not saved — retrying on next edit' },
};

/** Autosave indicator. */
@Component({
  selector: 'ac-save-status',
  template: `
    @if (label().text !== '') {
      <span class="status" [class.error]="status() === 'error'" role="status"
        ><i [class]="label().icon" aria-hidden="true"></i>{{ label().text }}</span
      >
    }
  `,
  styles: `
    .status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--ac-muted);
    }
    .status i {
      font-size: 10px;
    }
    .error {
      color: var(--p-red-500);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveStatusComponent {
  /** Save status. */
  readonly status = input.required<SaveStatus>();

  protected readonly label = computed(() => LABELS[this.status()]);
}

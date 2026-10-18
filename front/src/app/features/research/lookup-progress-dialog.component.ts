import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { ResearchStore } from './research.store';

const PERCENT = 100;

/** Blocking progress of "Find info": runs in this tab, so the user must keep it open. */
@Component({
  selector: 'ac-lookup-progress-dialog',
  imports: [ButtonModule, DialogModule, ProgressBarModule],
  template: `
    @let operation = store.lookupOperation();
    <p-dialog
      header="Finding paper info"
      [modal]="true"
      [visible]="operation !== null"
      [closable]="!running()"
      [closeOnEscape]="!running()"
      (visibleChange)="$event ? null : store.closeLookup()"
      [style]="{ width: 'min(520px, 96vw)' }"
    >
      @if (operation) {
        <p-progressbar [value]="percent()" [showValue]="false" />
        <p class="counts">
          {{ operation.done }} / {{ operation.total }} paper(s)
          @if (operation.message && running()) {
            · {{ operation.message }}
          }
        </p>
        @if (running()) {
          @if (store.lookupCurrent(); as current) {
            <p class="current">
              <i class="pi pi-spin pi-spinner"></i> Searching <strong>{{ current }}</strong>
            </p>
          }
          <p class="warning">
            <i class="pi pi-exclamation-triangle"></i>
            Don't close or reload this window: the search runs in this tab and stops if it closes.
          </p>
        } @else {
          <p [class.error]="operation.status === 'failed'">{{ operation.message }}</p>
        }
      }
      <ng-template #footer>
        @if (!running()) {
          <p-button
            label="Close"
            severity="secondary"
            [outlined]="true"
            (onClick)="store.closeLookup()"
          />
          <p-button label="Show papers to review" icon="pi pi-filter" (onClick)="showToReview()" />
        }
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .counts {
      margin: 10px 0 0;
      font-size: 13px;
      color: var(--ac-muted);
    }

    .current {
      margin: 12px 0 0;
      overflow-wrap: anywhere;

      i {
        margin-right: 6px;
      }
    }

    .warning {
      margin: 16px 0 0;
      padding: 10px 12px;
      border-radius: 6px;
      background: color-mix(in srgb, #f59e0b 15%, transparent);
      font-size: 13px;

      i {
        margin-right: 6px;
        color: #f59e0b;
      }
    }

    .error {
      color: #ef4444;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LookupProgressDialogComponent {
  protected readonly store = inject(ResearchStore);

  protected readonly running = computed(() => this.store.lookupOperation()?.status === 'running');
  protected readonly percent = computed(() => {
    const operation = this.store.lookupOperation();
    return operation === null || operation.total === 0
      ? 0
      : Math.round((operation.done / operation.total) * PERCENT);
  });

  /** Close and filter the library on papers to review. */
  protected showToReview(): void {
    this.store.closeLookup();
    this.store.status.set('To review');
  }
}

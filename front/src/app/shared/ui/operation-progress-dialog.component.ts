import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { OperationInfo } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';

const PERCENT = 100;

/** Blocking progress of an operation running in this tab, so the user must keep it open. */
@Component({
  selector: 'ac-operation-progress-dialog',
  imports: [ButtonModule, DialogModule, ProgressBarModule],
  host: { '(window:beforeunload)': 'warnBeforeUnload($event)' },
  template: `
    @let current = operation();
    <p-dialog
      [header]="header()"
      [modal]="true"
      [visible]="current !== null"
      [closable]="!running()"
      [closeOnEscape]="!running()"
      (visibleChange)="$event ? null : closed.emit()"
      [style]="{ width: 'min(520px, 96vw)' }"
    >
      @if (current) {
        <p-progressbar [value]="percent()" [showValue]="false" />
        <p class="counts">
          {{ current.done }} / {{ current.total }} {{ unit() }}
          @if (current.message && running()) {
            · {{ current.message }}
          }
        </p>
        @if (running()) {
          @if (item(); as name) {
            <p class="current">
              <i class="pi pi-spin pi-spinner"></i> {{ verb() }} <strong>{{ name }}</strong>
            </p>
          }
          <p class="warning">
            <i class="pi pi-exclamation-triangle"></i>
            Don't close or reload this window: the work runs in this tab and stops if it closes.
          </p>
        } @else {
          <p [class.error]="current.status === 'failed'">{{ current.message }}</p>
        }
      }
      <ng-template #footer>
        @if (!running()) {
          <p-button
            label="Close"
            severity="secondary"
            [outlined]="true"
            (onClick)="closed.emit()"
          />
          <ng-content select="[actions]" />
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
export class OperationProgressDialogComponent {
  /** Dialog title. */
  readonly header = input.required<string>();
  /** Operation shown (`null` hides the dialog). */
  readonly operation = input.required<OperationInfo | null>();
  /** Item being processed. */
  readonly item = input<string | null>(null);
  /** Counted unit, e.g. "file(s)". */
  readonly unit = input('item(s)');
  /** Verb before the current item. */
  readonly verb = input('Processing');
  /** Close requested (only possible once finished). */
  readonly closed = output();

  protected readonly running = computed(() => this.operation()?.status === 'running');
  protected readonly percent = computed(() => {
    const operation = this.operation();
    return operation === null || operation.total === 0
      ? 0
      : Math.round((operation.done / operation.total) * PERCENT);
  });

  /**
   * Warn before closing the tab while the operation runs.
   *
   * @param event - Unload event.
   */
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.running()) {
      event.preventDefault();
    }
  }
}

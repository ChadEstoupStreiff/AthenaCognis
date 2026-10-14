import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import type { AiOperation } from '@domain/contracts';
import { JobsStore } from '../../core/jobs/jobs.store';
import { NotifyService } from '../../core/notify/notify.service';

/** Operation choices. */
const OPERATIONS: readonly {
  readonly value: AiOperation;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 'ocr', label: 'Text & caption (OCR)', hint: 'Images only' },
  { value: 'transcription', label: 'Transcription', hint: 'Audio and video only' },
  {
    value: 'summary',
    label: 'Summary & keywords',
    hint: 'Waits for OCR/transcription when needed',
  },
  { value: 'preview', label: 'Regenerate preview', hint: 'Thumbnail used in cards' },
];

/** Queue AI processing on several files. */
@Component({
  selector: 'ac-ai-actions-dialog',
  imports: [FormsModule, ButtonModule, CheckboxModule, DialogModule],
  template: `
    <p-dialog
      header="AI processing"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(460px, 96vw)' }"
      [dismissableMask]="true"
    >
      <p class="ac-muted">
        {{ paths().length }} file(s). Jobs run in the background; follow them from the jobs
        indicator.
      </p>
      @for (operation of operations; track operation.value) {
        <label class="row">
          <p-checkbox
            [binary]="true"
            [ngModel]="selected().includes(operation.value)"
            (onChange)="toggle(operation.value)"
          />
          <span>
            <strong>{{ operation.label }}</strong>
            <small class="ac-muted">{{ operation.hint }}</small>
          </span>
        </label>
      }
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          label="Run"
          icon="pi pi-sparkles"
          [disabled]="selected().length === 0"
          (onClick)="run()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 8px 0;
      cursor: pointer;
    }
    .row span {
      display: flex;
      flex-direction: column;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiActionsDialogComponent {
  private readonly jobs = inject(JobsStore);
  private readonly notify = inject(NotifyService);

  /** Dialog visibility (two-way). */
  readonly visible = model(false);
  /** Files to process. */
  readonly paths = input.required<readonly string[]>();

  protected readonly operations = OPERATIONS;
  protected readonly selected = signal<readonly AiOperation[]>(['summary']);

  /**
   * Toggle an operation.
   *
   * @param operation - Operation.
   */
  protected toggle(operation: AiOperation): void {
    this.selected.update((list) =>
      list.includes(operation) ? list.filter((item) => item !== operation) : [...list, operation],
    );
  }

  /** Start the pipeline. */
  protected run(): void {
    const operation = this.jobs.runPipeline({ paths: this.paths(), operations: this.selected() });
    this.notify.info(
      'AI processing started',
      `${operation.label} — keep this tab open until requests are queued.`,
    );
    this.visible.set(false);
  }
}

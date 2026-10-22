import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import {
  EMPTY_INFO,
  type Paper,
  type PaperInfo,
  paperFileName,
  paperUploadDate,
} from '@domain/sota';
import { PaperFormComponent } from './paper-form.component';
import { ResearchStore } from './research.store';

/** Edit the reference of one paper. */
@Component({
  selector: 'ac-paper-dialog',
  imports: [ButtonModule, DialogModule, PaperFormComponent],
  template: `
    <p-dialog
      header="Edit reference"
      [modal]="true"
      [visible]="paper() !== null"
      (visibleChange)="$event ? null : closed.emit()"
      [style]="{ width: 'min(760px, 98vw)' }"
    >
      @if (paper(); as current) {
        <p class="ac-muted caption">
          <i class="pi pi-file"></i> {{ fileName(current) }} · added {{ uploadDate(current) }}
        </p>
        <ac-paper-form [(info)]="draft" (submitted)="save(false)" />
      }
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="closed.emit()" />
        <p-button
          label="Save"
          icon="pi pi-save"
          severity="secondary"
          [outlined]="true"
          [loading]="saving()"
          (onClick)="save(false)"
        />
        <p-button
          label="Save & validate"
          icon="pi pi-verified"
          [loading]="saving()"
          (onClick)="save(true)"
        />
      </ng-template>
    </p-dialog>
  `,
  styleUrl: './research-dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperDialogComponent {
  private readonly store = inject(ResearchStore);

  /** Paper to edit (null = closed). */
  readonly paper = input<Paper | null>(null);
  /** Emits when the dialog closes. */
  readonly closed = output();

  protected readonly draft = signal<PaperInfo>(EMPTY_INFO);
  protected readonly saving = signal(false);
  protected readonly fileName = paperFileName;
  protected readonly uploadDate = paperUploadDate;

  /** Copy the paper into the draft when opened. */
  constructor() {
    effect(() => {
      const paper = this.paper();
      untracked(() => {
        this.draft.set(paper?.info ?? EMPTY_INFO);
      });
    });
  }

  /**
   * Save (and optionally validate).
   *
   * @param validate - Mark validated.
   */
  protected async save(validate: boolean): Promise<void> {
    const paper = this.paper();
    if (paper === null) {
      return;
    }
    this.saving.set(true);
    try {
      const info = { ...this.draft(), validated: validate || paper.info.validated };
      if ((await this.store.save(new Map([[paper.path, info]]))) > 0) {
        this.closed.emit();
      }
    } finally {
      this.saving.set(false);
    }
  }
}

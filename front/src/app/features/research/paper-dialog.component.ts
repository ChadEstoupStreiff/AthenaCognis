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
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import {
  EMPTY_INFO,
  type Paper,
  type PaperInfo,
  paperFileName,
  paperUploadDate,
} from '@domain/sota';
import { ResearchStore } from './research.store';

/** Edit the reference of one paper. */
@Component({
  selector: 'ac-paper-dialog',
  imports: [FormsModule, ButtonModule, DialogModule, InputTextModule],
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
        <form class="form" (ngSubmit)="save(false)">
          <label class="field wide"
            ><span>Title</span
            ><input
              pInputText
              name="title"
              [ngModel]="draft().title"
              (ngModelChange)="set('title', $event)"
          /></label>
          <label class="field wide">
            <span>Authors <small>separate with |, e.g. Doe, John | Smith, Ann</small></span>
            <input
              pInputText
              name="authors"
              [ngModel]="draft().authors"
              (ngModelChange)="set('authors', $event)"
            />
          </label>
          <label class="field"
            ><span>Year</span
            ><input
              pInputText
              name="year"
              [ngModel]="draft().year"
              (ngModelChange)="set('year', $event)"
          /></label>
          <label class="field span3"
            ><span>Journal</span
            ><input
              pInputText
              name="journal"
              [ngModel]="draft().journal"
              (ngModelChange)="set('journal', $event)"
          /></label>
          <label class="field"
            ><span>Volume</span
            ><input
              pInputText
              name="volume"
              [ngModel]="draft().volume"
              (ngModelChange)="set('volume', $event)"
          /></label>
          <label class="field"
            ><span>Issue</span
            ><input
              pInputText
              name="issue"
              [ngModel]="draft().issue"
              (ngModelChange)="set('issue', $event)"
          /></label>
          <label class="field span2"
            ><span>Pages</span
            ><input
              pInputText
              name="pages"
              [ngModel]="draft().pages"
              (ngModelChange)="set('pages', $event)"
          /></label>
          <label class="field span2"
            ><span>DOI</span
            ><input
              pInputText
              name="doi"
              [ngModel]="draft().doi"
              (ngModelChange)="set('doi', $event)"
          /></label>
          <label class="field span2"
            ><span>URL</span
            ><input
              pInputText
              name="url"
              [ngModel]="draft().url"
              (ngModelChange)="set('url', $event)"
          /></label>
          <button type="submit" hidden></button>
        </form>
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
   * Change one field.
   *
   * @param field - Field.
   * @param value - Value.
   */
  protected set(field: keyof PaperInfo, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
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

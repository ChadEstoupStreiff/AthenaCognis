import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { NotifyService } from '../../core/notify/notify.service';
import { ResearchStore } from './research.store';
import { type ExportFormat, LibraryTransfer } from './transfer';

/** Export scope. */
type Scope = 'selected' | 'shown' | 'library';

/** Export references to Zotero (RIS) or BibTeX, optionally with PDFs. */
@Component({
  selector: 'ac-export-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    RadioButtonModule,
    SelectButtonModule,
    ToggleSwitchModule,
  ],
  template: `
    <p-dialog
      header="Export references"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(520px, 96vw)' }"
    >
      <div class="options">
        <div class="option">
          <strong>Format</strong>
          <p-selectbutton
            [options]="formats"
            optionValue="value"
            [allowEmpty]="false"
            [ngModel]="format()"
            (ngModelChange)="format.set($event)"
            size="small"
            ariaLabel="Format"
          />
        </div>
        <div>
          <strong>References</strong>
          @for (option of scopes(); track option.value) {
            <label class="option radio">
              <span
                ><p-radiobutton
                  name="scope"
                  [value]="option.value"
                  [ngModel]="scope()"
                  (ngModelChange)="scope.set($event)"
                  [disabled]="option.count === 0"
                />
                {{ option.label }}</span
              >
              <span class="ac-muted">{{ option.count }}</span>
            </label>
          }
        </div>
        <label class="option">
          <span
            ><strong>Include PDFs</strong><br /><small class="ac-muted"
              >Zip with PDFs in files/, linked so Zotero re-attaches them.</small
            ></span
          >
          <p-toggleswitch
            [ngModel]="withPdfs()"
            (ngModelChange)="withPdfs.set($event)"
            ariaLabel="Include PDFs"
          />
        </label>
      </div>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          label="Download"
          icon="pi pi-download"
          [loading]="working()"
          [disabled]="targets().length === 0"
          (onClick)="run()"
        />
      </ng-template>
    </p-dialog>
  `,
  styleUrl: './research-dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDialogComponent {
  private readonly store = inject(ResearchStore);
  private readonly transfer = inject(LibraryTransfer);
  private readonly notify = inject(NotifyService);

  /** Visibility (two-way). */
  readonly visible = model(false);

  protected readonly formats: { value: ExportFormat; label: string }[] = [
    { value: 'ris', label: 'Zotero (RIS)' },
    { value: 'bibtex', label: 'BibTeX' },
  ];
  protected readonly format = signal<ExportFormat>('ris');
  protected readonly withPdfs = signal(false);
  protected readonly working = signal(false);
  protected readonly scopes = computed(() => [
    { value: 'selected' as const, label: 'Selected papers', count: this.store.selection().length },
    {
      value: 'shown' as const,
      label: 'Papers shown in the list',
      count: this.store.visible().length,
    },
    { value: 'library' as const, label: 'Whole library', count: this.store.papers().length },
  ]);
  /** Narrowest non-empty scope by default (reset when opened). */
  protected readonly scope = linkedSignal<Scope>(() => {
    this.visible();
    return this.store.selected().size > 0
      ? 'selected'
      : this.store.visible().length > 0
        ? 'shown'
        : 'library';
  });
  protected readonly targets = computed(() => {
    const scope = this.scope();
    return scope === 'selected'
      ? this.store.selection()
      : scope === 'shown'
        ? this.store.visible()
        : this.store.papers();
  });

  /** Build and download the export. */
  protected async run(): Promise<void> {
    this.working.set(true);
    try {
      await this.transfer.export(this.targets(), this.format(), this.withPdfs());
      this.visible.set(false);
    } catch (error) {
      this.notify.error(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      this.working.set(false);
    }
  }
}

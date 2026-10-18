import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  collectSources,
  type ImportPlanItem,
  type ImportSources,
  paperFileName,
  parseSources,
  planImport,
} from '@domain/sota';
import { NotifyService } from '../../core/notify/notify.service';
import { ResearchStore } from './research.store';
import { LibraryTransfer } from './transfer';

const ZOTERO_HELP =
  'In Zotero: File → Export Library… (or right-click a collection → Export), format BibTeX or RIS, tick “Export Files”, then zip the exported folder and drop the zip here.';

/** Import a BibTeX / RIS bibliography (Zotero, Mendeley, EndNote) with optional PDFs. */
@Component({
  selector: 'ac-import-dialog',
  imports: [FormsModule, ButtonModule, DialogModule, ToggleSwitchModule],
  templateUrl: './import-dialog.component.html',
  styleUrl: './research-dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportDialogComponent {
  private readonly store = inject(ResearchStore);
  private readonly transfer = inject(LibraryTransfer);
  private readonly notify = inject(NotifyService);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** SOTA tag given to added PDFs. */
  readonly tag = input.required<string>();

  protected readonly help = ZOTERO_HELP;
  protected readonly sources = signal<ImportSources | null>(null);
  protected readonly over = signal(false);
  protected readonly markValidated = signal(true);
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly plan = computed<readonly ImportPlanItem[]>(() => {
    const sources = this.sources();
    return sources === null
      ? []
      : planImport(parseSources(sources), this.store.papers(), new Set(sources.pdfs.keys()));
  });
  protected readonly counts = computed(() => ({
    update: this.plan().filter((item) => item.action === 'update').length,
    add: this.plan().filter((item) => item.action === 'add').length,
    skip: this.plan().filter((item) => item.action === 'skip').length,
  }));
  protected readonly actionable = computed(() => this.counts().update + this.counts().add);
  protected readonly fileName = paperFileName;

  /**
   * Read picked files.
   *
   * @param event - Change event of the file input.
   */
  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await this.read([...(input.files ?? [])]);
    input.value = '';
  }

  /**
   * Read dropped files.
   *
   * @param event - Drop event.
   */
  protected async drop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.over.set(false);
    await this.read([...(event.dataTransfer?.files ?? [])]);
  }

  /** Apply the plan. */
  protected async run(): Promise<void> {
    const sources = this.sources();
    if (sources === null) {
      return;
    }
    this.working.set(true);
    try {
      const outcome = await this.transfer.import(
        this.plan(),
        sources.pdfs,
        this.tag(),
        this.markValidated(),
      );
      this.notify.success(`${String(outcome.imported)} reference(s) imported.`);
      if (outcome.failed.length > 0) {
        this.notify.error(`Import failed for: ${outcome.failed.join(', ')}`);
      }
      this.reset();
    } finally {
      this.working.set(false);
    }
  }

  /** Close and forget the files. */
  protected reset(): void {
    this.sources.set(null);
    this.error.set(null);
    this.visible.set(false);
  }

  /**
   * Collect bibliographies and PDFs.
   *
   * @param files - Files.
   */
  private async read(files: readonly File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    this.error.set(null);
    try {
      const uploads = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const sources = collectSources(uploads);
      this.sources.set(sources);
      if (parseSources(sources).length === 0) {
        this.error.set(
          'No reference found. Add a .bib or .ris file (PDFs alone carry no bibliography).',
        );
      }
    } catch {
      this.sources.set(null);
      this.error.set('Could not read the zip archive.');
    }
  }
}

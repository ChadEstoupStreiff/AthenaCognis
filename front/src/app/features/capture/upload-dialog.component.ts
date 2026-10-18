import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { lastValueFrom, tap } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { ProgressBarModule } from 'primeng/progressbar';
import { formatLocalDate } from '@domain/time';
import { toApiProblem } from '../../core/api/api-error';
import { CaptureService } from '../../core/capture/capture.service';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { viewerCommands } from '../../shared/files/file-row';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import { numberedName, storedNameHint, type UploadItem, type UploadOverride } from './upload-item';

const UPLOAD_FOLDER = 'uploads';
const PERCENT = 100;
const MAX_RENAME_ATTEMPTS = 50;

/** Upload dialog: drop files, set date/projects/tags/people, rename, upload with progress. */
@Component({
  selector: 'ac-upload-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    DialogModule,
    InputTextModule,
    MultiSelectModule,
    ProgressBarModule,
    BytesPipe,
    TagChipComponent,
  ],
  templateUrl: './upload-dialog.component.html',
  styleUrl: './upload-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadDialogComponent {
  protected readonly capture = inject(CaptureService);
  protected readonly catalog = inject(CatalogStore);
  private readonly files = inject(FilesApi);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private nextId = 0;

  protected readonly items = signal<readonly UploadItem[]>([]);
  protected readonly date = signal<Date>(new Date());
  protected readonly projects = signal<readonly string[]>([]);
  protected readonly tags = signal<readonly string[]>([]);
  protected readonly contacts = signal<readonly string[]>([]);
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly tagOptions = computed(() => this.catalog.tagList().map((tag) => tag.name));
  protected readonly contactOptions = computed(() =>
    this.catalog.contactList().map((contact) => ({ label: contact.name, value: contact.id })),
  );
  protected readonly pendingCount = computed(
    () => this.items().filter((item) => item.state !== 'done').length,
  );
  protected readonly finished = computed(
    () => this.items().length > 0 && this.pendingCount() === 0,
  );
  protected readonly hint = storedNameHint;

  /** Pull files dropped anywhere in the app, and context defaults on open. */
  constructor() {
    effect(() => {
      const files = this.capture.pendingFiles();
      if (files.length > 0) {
        untracked(() => {
          this.addFiles(files);
          this.capture.pendingFiles.set([]);
        });
      }
    });
    effect(() => {
      if (this.capture.uploadOpen()) {
        untracked(() => {
          this.applyDefaults();
        });
      }
    });
  }

  /**
   * Add files from the picker.
   *
   * @param event - Change event of the file input.
   */
  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles([...(input.files ?? [])]);
    input.value = '';
  }

  /**
   * Add dropped files.
   *
   * @param event - Drop event.
   */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.addFiles([...(event.dataTransfer?.files ?? [])]);
  }

  /**
   * Rename one item.
   *
   * @param id - Item id.
   * @param name - New name.
   */
  protected rename(id: number, name: string): void {
    this.patch(id, { name, state: 'ready', message: null });
  }

  /**
   * Turn per-file overrides on (starting from the defaults) or off.
   *
   * @param id - Item id.
   * @param enabled - Whether the item overrides the defaults.
   */
  protected toggleOverride(id: number, enabled: boolean): void {
    const override: UploadOverride | null = enabled
      ? { date: this.date(), projects: this.projects(), tags: this.tags() }
      : null;
    this.patch(id, { override });
  }

  /**
   * Change one override field.
   *
   * @param item - Item.
   * @param patch - Changed fields.
   */
  protected patchOverride(item: UploadItem, patch: Partial<UploadOverride>): void {
    if (item.override !== null) {
      this.patch(item.id, { override: { ...item.override, ...patch } });
    }
  }

  /**
   * Remove one item.
   *
   * @param id - Item id.
   */
  protected remove(id: number): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  /** Upload every pending item, one at a time. */
  protected async uploadAll(): Promise<void> {
    this.busy.set(true);
    try {
      await this.resolveConflicts();
      for (const item of this.items().filter(
        (candidate) => candidate.state === 'ready' || candidate.state === 'error',
      )) {
        await this.uploadOne(item);
      }
      this.files.uploadsFinished();
      const done = this.items().filter((item) => item.state === 'done').length;
      this.notify.success(`${String(done)} file(s) uploaded.`);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Open an uploaded file.
   *
   * @param item - Uploaded item.
   */
  protected view(item: UploadItem): void {
    if (item.storedPath !== null) {
      this.close();
      void this.router.navigate(viewerCommands(item.storedPath));
    }
  }

  /** Close and reset. */
  protected close(): void {
    this.capture.uploadOpen.set(false);
    if (!this.busy()) {
      this.items.set([]);
    }
  }

  /**
   * Append files as items.
   *
   * @param files - Files.
   */
  private addFiles(files: readonly File[]): void {
    const added = files.map((file) => ({
      id: this.nextId++,
      file,
      name: file.name,
      state: 'ready' as const,
      progress: 0,
      message: null,
      storedPath: null,
      override: null,
    }));
    this.items.update((items) => [...items, ...added]);
  }

  /** Copy context defaults (project/contact pages) into the form. */
  private applyDefaults(): void {
    const defaults = this.capture.defaults();
    this.projects.set(defaults.projects);
    this.tags.set(defaults.tags);
    this.contacts.set(defaults.contacts);
    this.date.set(new Date());
  }

  /** Rename items whose target already exists (the backend would delete the old file). */
  private async resolveConflicts(): Promise<void> {
    const pending = this.items().filter((item) => item.state !== 'done');
    const plan = await this.files.uploadPlan(
      pending.map((item) => ({ name: item.name, date: this.dateOf(item), folder: UPLOAD_FOLDER })),
    );
    for (const [index, entry] of plan.entries()) {
      const item = pending[index];
      if (item !== undefined && entry.exists) {
        const name = await this.freeName(item.name, this.dateOf(item));
        this.patch(item.id, { name, message: `Renamed: ${entry.storedName} already exists.` });
      }
    }
  }

  /**
   * Find a name that does not exist yet.
   *
   * @param name - Wanted name.
   * @param date - Upload date.
   * @returns A free name.
   */
  private async freeName(name: string, date: string): Promise<string> {
    const candidates = Array.from({ length: MAX_RENAME_ATTEMPTS }, (_, index) =>
      numberedName(name, index + 2),
    );
    const plan = await this.files.uploadPlan(
      candidates.map((candidate) => ({ name: candidate, date, folder: UPLOAD_FOLDER })),
    );
    return plan.find((entry) => !entry.exists)?.name ?? numberedName(name, Date.now());
  }

  /**
   * Upload one item and record its outcome.
   *
   * @param item - Item.
   */
  private async uploadOne(item: UploadItem): Promise<void> {
    const current = this.items().find((candidate) => candidate.id === item.id) ?? item;
    this.patch(item.id, { state: 'uploading', progress: 0 });
    try {
      const target = { folder: UPLOAD_FOLDER, date: this.dateOf(current), name: current.name };
      const override = current.override;
      const relations = {
        projects: override?.projects ?? this.projects(),
        tags: override?.tags ?? this.tags(),
        contacts: this.contacts(),
      };
      const last = await lastValueFrom(
        this.files.upload(current.file, target, relations).pipe(
          tap((event) => {
            if (event.kind === 'progress') {
              this.patch(item.id, { progress: Math.round(event.fraction * PERCENT) });
            }
          }),
        ),
      );
      this.patch(item.id, {
        state: 'done',
        progress: PERCENT,
        storedPath: last.kind === 'done' ? last.result.path : null,
      });
    } catch (error) {
      this.patch(item.id, { state: 'error', message: toApiProblem(error).message });
    }
  }

  /**
   * Upload date of an item (override or dialog default).
   *
   * @param item - Item.
   * @returns `YYYY-MM-DD`.
   */
  private dateOf(item: UploadItem): string {
    return formatLocalDate(item.override?.date ?? this.date());
  }

  /**
   * Update one item.
   *
   * @param id - Item id.
   * @param patch - Changed fields.
   */
  private patch(id: number, patch: Partial<UploadItem>): void {
    this.items.update((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
}

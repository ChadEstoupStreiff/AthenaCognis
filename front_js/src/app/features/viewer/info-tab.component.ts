import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import type { FileMetadata } from '@domain/contracts';
import { KNOWN_SUBFOLDERS, parseSharedPath } from '@domain/files';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { viewerCommands } from '../../shared/files/file-row';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';

/** Relation kinds edited here. */
type RelationKind = 'projects' | 'tags';

/** Name, date, folder, projects, tags and metadata of a file. */
@Component({
  selector: 'ac-info-tab',
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    TagChipComponent,
    BytesPipe,
  ],
  templateUrl: './info-tab.component.html',
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoTabComponent {
  private readonly files = inject(FilesApi);
  private readonly catalog = inject(CatalogStore);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);

  /** Shared path. */
  readonly path = input.required<string>();
  /** Metadata. */
  readonly metadata = input<FileMetadata | null>(null);
  /** Open the viewer on the new location after a move (off in the side panel). */
  readonly navigateOnMove = input(true);
  /** New path after a move. */
  readonly moved = output<string>();

  private readonly parts = computed(() => parseSharedPath(this.path()));
  protected readonly name = linkedSignal(() => this.parts()?.name ?? '');
  protected readonly date = linkedSignal(() => parseLocalDate(this.parts()?.date ?? ''));
  protected readonly folder = linkedSignal(() => this.parts()?.folder ?? 'uploads');
  protected readonly folderOptions = computed(() => [
    ...new Set([...KNOWN_SUBFOLDERS, this.parts()?.folder ?? 'uploads']),
  ]);
  protected readonly moving = signal(false);
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly tagOptions = computed(() => this.catalog.tagList().map((tag) => tag.name));

  protected readonly relations = resource({
    params: () => ({ path: this.path(), version: this.sync.version('files')() }),
    loader: async ({ params }) => (await this.files.relations([params.path]))[params.path] ?? null,
  });

  protected readonly dirty = computed(() => {
    const parts = this.parts();
    const date = this.date();
    return (
      parts !== null &&
      (this.name().trim() !== parts.name ||
        (date !== null && formatLocalDate(date) !== parts.date) ||
        this.folder() !== parts.folder)
    );
  });

  /** Rename/move the file and open its new location. */
  protected async move(): Promise<void> {
    const parts = this.parts();
    const date = this.date();
    if (parts === null || !this.dirty()) {
      return;
    }
    this.moving.set(true);
    try {
      const newPath = await this.files.move({
        path: this.path(),
        name: this.name().trim() === parts.name ? undefined : this.name().trim(),
        date:
          date === null || formatLocalDate(date) === parts.date ? undefined : formatLocalDate(date),
        folder: this.folder() === parts.folder ? undefined : this.folder(),
      });
      this.notify.success('File moved.');
      this.moved.emit(newPath);
      if (this.navigateOnMove()) {
        await this.router.navigate(viewerCommands(newPath), { replaceUrl: true });
      }
    } finally {
      this.moving.set(false);
    }
  }

  /**
   * Apply a new set of projects or tags.
   *
   * @param kind - Projects or tags.
   * @param names - New names.
   */
  protected async setRelations(kind: RelationKind, names: readonly string[]): Promise<void> {
    const current = this.relations.value()?.[kind] ?? [];
    const diff = {
      add: names.filter((name) => !current.includes(name)),
      remove: current.filter((name) => !names.includes(name)),
    };
    await this.files.patchRelations({ paths: [this.path()], [kind]: diff });
  }

  /** Copy the path to the clipboard. */
  protected async copyPath(): Promise<void> {
    await navigator.clipboard.writeText(this.path());
    this.notify.info('Path copied.');
  }
}

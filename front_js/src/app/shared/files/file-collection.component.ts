import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  resource,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { type TablePageEvent, TableModule } from 'primeng/table';
import type { FileRelations, RepresentationMode } from '@domain/contracts';
import { FilesApi } from '../../core/files/files.api';
import { PeekService } from '../../core/files/peek.service';
import { DataSync } from '../../core/state/data-sync.service';
import { InViewDirective } from '../directives/in-view.directive';
import { RelativeDatePipe } from '../pipes/relative-date.pipe';
import { EmptyStateComponent } from '../ui/empty-state.component';
import { TagChipComponent } from '../ui/tag-chip.component';
import { type FileRow, toFileRow, viewerCommands } from './file-row';
import { FileSummarySnippetComponent } from './file-summary-snippet.component';
import { FileThumbnailComponent } from './file-thumbnail.component';

const PAGE_SIZE = 60;
const TABLE_PAGE_SIZE = 50;
const NO_RELATIONS: FileRelations = { projects: [], tags: [], pinned: false };
/** Delay before a single click opens Quick Look (a double click opens the viewer instead). */
const SINGLE_CLICK_DELAY_MS = 220;

/** What a click on a file does. */
export type FileClickAction = 'peek' | 'select';

/** Files shown as cards, list rows or a table, with selection. */
@Component({
  selector: 'ac-file-collection',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    TableModule,
    EmptyStateComponent,
    TagChipComponent,
    RelativeDatePipe,
    InViewDirective,
    FileThumbnailComponent,
    FileSummarySnippetComponent,
  ],
  templateUrl: './file-collection.component.html',
  styleUrl: './file-collection.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileCollectionComponent {
  private readonly files = inject(FilesApi);
  private readonly sync = inject(DataSync);
  private readonly peek = inject(PeekService);
  private readonly router = inject(Router);

  /** Paths to show. */
  readonly paths = input.required<readonly string[]>();
  /** Representation. */
  readonly mode = input<RepresentationMode>('cards');
  /** Allow selecting files. */
  readonly selectable = input(true);
  /** Single-click behaviour. */
  readonly clickAction = input<FileClickAction>('peek');
  /** Selected paths (two-way). */
  readonly selection = model<readonly string[]>([]);
  /** Empty state title. */
  readonly emptyTitle = input('No files');
  /** Empty state message. */
  readonly emptyMessage = input<string | null>(null);

  protected readonly rows = computed(() => this.paths().map(toFileRow));
  protected readonly limit = linkedSignal({ source: this.paths, computation: () => PAGE_SIZE });
  protected readonly tableFirst = linkedSignal({ source: this.paths, computation: () => 0 });
  protected readonly tablePageSize = TABLE_PAGE_SIZE;
  protected readonly visibleRows = computed(() => this.rows().slice(0, this.limit()));
  protected readonly selectedSet = computed(() => new Set(this.selection()));
  protected readonly selectedRows = computed(() =>
    this.rows().filter((row) => this.selectedSet().has(row.path)),
  );

  private clickTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly relationPaths = computed(() => {
    if (this.mode() !== 'table') {
      return this.visibleRows().map((row) => row.path);
    }
    const first = this.tableFirst();
    return this.rows()
      .slice(first, first + TABLE_PAGE_SIZE)
      .map((row) => row.path);
  });

  protected readonly relations = resource({
    params: () => ({ paths: this.relationPaths(), version: this.sync.version('files')() }),
    loader: ({ params }) => this.files.relations(params.paths),
  });

  /**
   * Relations of a file (empty while loading).
   *
   * @param path - Shared path.
   * @returns Projects, tags, pin.
   */
  protected relationsOf(path: string): FileRelations {
    return this.relations.value()?.[path] ?? NO_RELATIONS;
  }

  /**
   * Handle a click on a file.
   *
   * @param row - Clicked file.
   * @param event - Mouse or keyboard event (Ctrl/Cmd/Shift selects).
   */
  protected activate(row: FileRow, event: Event): void {
    const modifier =
      event instanceof MouseEvent || event instanceof KeyboardEvent
        ? event.ctrlKey || event.metaKey || event.shiftKey
        : false;
    if (
      this.selectable() &&
      (modifier || this.clickAction() === 'select' || this.selection().length > 0)
    ) {
      this.toggle(row.path);
      return;
    }
    if (event instanceof KeyboardEvent) {
      this.peek.open(row.path);
      return;
    }
    this.cancelPendingClick();
    this.clickTimer = setTimeout(() => {
      this.peek.open(row.path);
    }, SINGLE_CLICK_DELAY_MS);
  }

  /**
   * Open the full viewer.
   *
   * @param row - File.
   */
  protected openViewer(row: FileRow): void {
    this.cancelPendingClick();
    this.peek.close();
    void this.router.navigate(viewerCommands(row.path));
  }

  /** Cancel a pending single-click action. */
  private cancelPendingClick(): void {
    if (this.clickTimer !== null) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }

  /**
   * Toggle one file in the selection.
   *
   * @param path - Shared path.
   */
  protected toggle(path: string): void {
    this.selection.update((selected) =>
      selected.includes(path) ? selected.filter((item) => item !== path) : [...selected, path],
    );
  }

  /**
   * Sync the selection from the table.
   *
   * @param rows - Selected rows.
   */
  protected onTableSelection(rows: FileRow[] | FileRow | null | undefined): void {
    const list = Array.isArray(rows) ? rows : rows === null || rows === undefined ? [] : [rows];
    this.selection.set(list.map((row) => row.path));
  }

  /**
   * Track the table page (relations are fetched per page).
   *
   * @param event - Page event.
   */
  protected onTablePage(event: TablePageEvent): void {
    this.tableFirst.set(event.first);
  }

  /** Render more cards/rows. */
  protected showMore(): void {
    this.limit.update((value) => value + PAGE_SIZE);
  }
}

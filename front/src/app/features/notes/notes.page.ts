import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MenuModule } from 'primeng/menu';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import {
  buildSharedPath,
  extensionOf,
  fileNameOf,
  isSharedFilePath,
  parseSharedPath,
  splitExtension,
} from '@domain/files';
import { formatFileTime, formatLocalDate, parseLocalDate } from '@domain/time';
import { ACTIVITY_PROJECT } from '@domain/contracts';
import { ActivityApi } from '../../core/activity/activity.api';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { FilesApi } from '../../core/files/files.api';
import { NoteHistoryApi } from '../../core/files/note-history.api';
import { Logger } from '../../core/logging/logger.service';
import { ProjectsApi } from '../../core/projects/projects.api';
import { NotifyService } from '../../core/notify/notify.service';
import { AutosaveController } from '../../core/state/autosave';
import { DataSync } from '../../core/state/data-sync.service';
import { FilePickerDialogComponent } from '../../shared/files/file-picker-dialog.component';
import { viewerCommands } from '../../shared/files/file-row';
import {
  extractHeadings,
  type Heading,
  textStats,
  toggleTask,
} from '../../shared/text/markdown-structure';
import { AiAssistComponent } from '../../shared/ui/ai-assist.component';
import {
  type FileUploader,
  MarkdownEditorComponent,
} from '../../shared/ui/markdown-editor.component';
import { MarkdownToolbarComponent } from '../../shared/ui/markdown-toolbar.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { persistedWidth } from '../../shared/ui/persisted-width';
import { ResizeHandleComponent } from '../../shared/ui/resize-handle.component';
import { SaveStatusComponent } from '../../shared/ui/save-status.component';
import { AGENDA_SOURCE, agendaMarkdown } from './note-agenda';
import { NoteCompletions } from './note-completions';
import { type ExportFormat, NoteExport } from './note-export';
import { NoteHistoryDialogComponent } from './note-history-dialog.component';
import { filterNotes, groupNotesByDay, splitPinned } from './note-list';
import { fileMarkdown } from './note-references';
import { NoteRelations } from './note-relations';
import { NoteScrollSync } from './note-scroll-sync';

/** Editor layouts. */
type NotesLayout = 'split' | 'edit' | 'preview';

/** Pending autosave. */
interface NoteDraft {
  readonly path: string;
  readonly content: string;
}

const NOTES_FOLDER = 'notes';
const PREVIEW_WIDTH_KEY = 'ac.notes.previewWidth';
const SYNC_SCROLL_KEY = 'ac.notes.syncScroll';
const SIDEBAR_COLLAPSED_KEY = 'ac.notes.sidebarCollapsed';
/** No stored width: editor and preview split the space evenly. */
const EVEN_SPLIT = 0;
const NEW_NOTE = '# New post-it\n\n';
const MAX_NOTE_BYTES = 5_242_880;
const DAY_MS = 86_400_000;
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const OUTLINE_INDENT_PX = 12;
const AI_CONTEXT =
  'This is a markdown note: keep markdown formatting, use bullet points and emojis when useful.';
const LAYOUTS = [
  { value: 'edit', icon: 'pi pi-pencil', label: 'Edit' },
  { value: 'split', icon: 'pi pi-pause', label: 'Split' },
  { value: 'preview', icon: 'pi pi-eye', label: 'Preview' },
];

/**
 * Read a persisted on/off preference.
 *
 * @param key - Storage key.
 * @param fallback - Value when nothing is stored (or storage is unavailable).
 * @returns Stored value.
 */
function storedFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

/**
 * Persist an on/off preference.
 *
 * @param key - Storage key.
 * @param enabled - Value.
 */
function storeFlag(key: string, enabled: boolean): void {
  try {
    localStorage.setItem(key, enabled ? '1' : '0');
  } catch {
    // Preference only: storage may be unavailable.
  }
}

/**
 * Message of an unknown error.
 *
 * @param error - Error.
 * @returns Message, if any.
 */
function messageOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/** Daily Markdown notes with live preview, AI help, app links, history and autosave. */
@Component({
  selector: 'ac-notes-page',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MenuModule,
    SelectButtonModule,
    TooltipModule,
    AiAssistComponent,
    FilePickerDialogComponent,
    MarkdownEditorComponent,
    MarkdownToolbarComponent,
    MarkdownViewComponent,
    NoteHistoryDialogComponent,
    ResizeHandleComponent,
    SaveStatusComponent,
  ],
  providers: [NoteCompletions, NoteRelations],
  templateUrl: './notes.page.html',
  styleUrl: './notes.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPage {
  private readonly files = inject(FilesApi);
  private readonly details = inject(FileDetailsApi);
  private readonly projects = inject(ProjectsApi);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);
  private readonly logger = inject(Logger);
  private readonly history = inject(NoteHistoryApi);
  private readonly relations = inject(NoteRelations);
  private readonly exporter = inject(NoteExport);
  private readonly activity = inject(ActivityApi);
  private readonly scrollSync = new NoteScrollSync();
  protected readonly completions = inject(NoteCompletions);
  protected readonly editor = viewChild(MarkdownEditorComponent);
  private readonly previewPane = viewChild<ElementRef<HTMLElement>>('previewPane');

  /** Query parameter: note being edited. */
  readonly path = input<string | undefined>(undefined);
  /** Query parameter: `1` creates a note on arrival (from the New menu or palette). */
  readonly create = input<string | undefined>(undefined);

  protected readonly layouts = LAYOUTS;
  protected readonly outlineIndent = OUTLINE_INDENT_PX;
  protected readonly layout = signal<NotesLayout>('split');
  protected readonly content = signal('');
  protected readonly loaded = signal(false);
  protected readonly renaming = signal('');
  protected readonly syncScroll = signal(storedFlag(SYNC_SCROLL_KEY, true));
  protected readonly sidebarCollapsed = signal(storedFlag(SIDEBAR_COLLAPSED_KEY, false));
  protected readonly showHistory = signal(false);
  protected readonly showEmbedPicker = signal(false);
  protected readonly aiContext = AI_CONTEXT;
  protected readonly aiSource = (): string => this.editor()?.selectedText() ?? this.content();
  protected readonly notePath = computed(() => {
    const path = this.path();
    return path !== undefined && isSharedFilePath(path) ? path : null;
  });
  /** Day of the open note (agenda insertion). */
  protected readonly day = computed(
    () => parseSharedPath(this.notePath() ?? '')?.date ?? formatLocalDate(new Date()),
  );
  protected readonly query = signal('');
  protected readonly isMarkdown = computed(() =>
    ['md', 'markdown', 'txt'].includes(extensionOf(this.notePath() ?? '')),
  );
  protected readonly headings = computed(() => extractHeadings(this.content()));
  protected readonly stats = computed(() => textStats(this.content()));
  protected readonly exportItems: MenuItem[] = [
    { label: 'HTML', icon: 'pi pi-code', command: () => void this.exportNote('html') },
    { label: 'PDF (print)', icon: 'pi pi-file-pdf', command: () => void this.exportNote('pdf') },
    { label: 'Word (.doc)', icon: 'pi pi-file-word', command: () => void this.exportNote('word') },
  ];

  /** Every note (assets in `notes/<note>/assets` are skipped). */
  protected readonly notes = resource({
    params: () => ({ version: this.sync.version('notes')() }),
    loader: async () =>
      (await this.files.folderFiles(NOTES_FOLDER)).filter((path) => isSharedFilePath(path)),
  });
  /** Pinned files (all kinds; intersected with notes). */
  private readonly pinnedResource = resource({
    params: () => ({ version: this.sync.version('pinned')() }),
    loader: () => this.details.pinnedFiles(),
  });
  protected readonly pinnedSet = computed<ReadonlySet<string>>(
    () => new Set(this.pinnedResource.hasValue() ? this.pinnedResource.value() : []),
  );
  /** Notes matching the search, split into pinned and the rest. */
  private readonly matchingNotes = computed(() =>
    splitPinned(
      filterNotes(this.notes.hasValue() ? this.notes.value() : [], this.query()),
      this.pinnedSet(),
    ),
  );
  /** Pinned notes matching the search, by name. */
  protected readonly pinnedNotes = computed(() => this.matchingNotes().pinned);
  /** Unpinned notes matching the search, grouped by day, newest first. */
  protected readonly noteDays = computed(() => groupNotesByDay(this.matchingNotes().others));

  /**
   * Store a pasted, dropped or picked file in `notes/<note name>/assets` of the current note.
   *
   * @param file - File.
   * @returns Inline URL of the stored file.
   */
  protected readonly uploadFile: FileUploader = async (file) => {
    const path = this.notePath();
    if (path === null) {
      throw new Error('No post-it is open.');
    }
    try {
      return await this.files.uploadNoteAsset(path, file);
    } catch (error) {
      this.notify.error(`${file.name} not added.`, messageOf(error));
      throw error;
    }
  };

  /** Notes written by Activity generation (marked with a bolt). */
  private readonly generatedResource = resource({
    params: () => ({
      notes: this.sync.version('notes')(),
      projects: this.sync.version('projects')(),
    }),
    loader: () => this.projects.files(ACTIVITY_PROJECT),
  });
  protected readonly generated = computed<ReadonlySet<string>>(
    () => new Set(this.generatedResource.hasValue() ? this.generatedResource.value() : []),
  );

  protected readonly previewWidth = persistedWidth(PREVIEW_WIDTH_KEY, EVEN_SPLIT);
  protected readonly autosave = new AutosaveController<NoteDraft>(
    (draft) => this.save(draft),
    inject(DestroyRef),
  );

  /** Load the note whenever the path changes; keep the scroll sync attached. */
  constructor() {
    effect(() => {
      const path = this.notePath();
      untracked(() => void this.load(path));
    });
    effect(() => {
      if (this.create() === '1') {
        untracked(() => void this.createNote());
      }
    });
    afterRenderEffect(() => {
      this.layout();
      this.syncScroll();
      this.refreshScrollSync();
    });
    inject(DestroyRef).onDestroy(() => {
      this.scrollSync.detach();
    });
  }

  /** Restore the even editor / preview split. */
  protected resetPreviewWidth(): void {
    this.previewWidth.set(EVEN_SPLIT);
  }

  /**
   * Pin or unpin a note.
   *
   * @param path - Note path.
   * @param event - Click event (kept from opening the note).
   */
  protected async togglePin(path: string, event: Event): Promise<void> {
    event.stopPropagation();
    const pinned = !this.pinnedSet().has(path);
    try {
      await this.details.setPinned(path, pinned);
    } catch (error) {
      this.notify.error(pinned ? 'Post-it not pinned.' : 'Post-it not unpinned.', messageOf(error));
    }
  }

  /**
   * File name of a path.
   *
   * @param path - Path.
   * @returns Name.
   */
  protected nameOf(path: string): string {
    return fileNameOf(path);
  }

  /**
   * Open a note.
   *
   * @param path - Note path.
   */
  protected open(path: string): void {
    void this.router.navigate([], {
      queryParams: { path, create: null },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Record an edit.
   *
   * @param text - New content.
   */
  protected onEdit(text: string): void {
    this.content.set(text);
    const path = this.notePath();
    if (path !== null && this.loaded()) {
      this.autosave.schedule({ path, content: text });
    }
  }

  /**
   * Tick or untick a task clicked in the preview.
   *
   * @param index - Task index.
   */
  protected toggleTask(index: number): void {
    this.onEdit(toggleTask(this.content(), index));
  }

  /** Create a note dated today and open it. */
  protected async createNote(): Promise<void> {
    const now = new Date();
    const path = buildSharedPath({
      date: formatLocalDate(now),
      folder: NOTES_FOLDER,
      name: `${formatFileTime(now)}.md`,
    });
    await this.files.writeText(path, NEW_NOTE, { summarize: false });
    this.open(path);
  }

  /** Rename the current note (its assets and history follow on the backend). */
  protected async rename(): Promise<void> {
    const path = this.notePath();
    const name = this.renaming().trim();
    if (path === null || name === '' || name === fileNameOf(path)) {
      return;
    }
    await this.autosave.flush();
    const target = extensionOf(name) === '' ? `${name}.md` : name;
    const newPath = await this.files.move({ path, name: target });
    this.relations.forget(path);
    this.notify.success('Post-it renamed.');
    this.open(newPath);
  }

  /**
   * Apply an AI suggestion to the selection (or the whole note).
   *
   * @param text - Suggestion.
   */
  protected applyAi(text: string): void {
    const editor = this.editor();
    if (editor === undefined) {
      this.onEdit(text);
      return;
    }
    editor.replaceSelection(text);
  }

  /** Open the note in the viewer. */
  protected openInViewer(): void {
    const path = this.notePath();
    if (path !== null) {
      void this.router.navigate(viewerCommands(path));
    }
  }

  /**
   * Smoothly scroll to a heading (the preview follows the editor when scroll sync is on).
   *
   * @param heading - Heading.
   * @param index - Heading index.
   */
  protected goToHeading(heading: Heading, index: number): void {
    const layout = this.layout();
    if (layout !== 'preview') {
      this.editor()?.revealLine(heading.line);
    }
    const followsEditor = layout === 'split' && this.syncScroll();
    if (layout !== 'edit' && !followsEditor) {
      const target = this.previewPane()?.nativeElement.querySelectorAll(HEADING_SELECTOR)[index];
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  /** Turn editor / preview scroll sync on or off. */
  protected toggleSyncScroll(): void {
    const enabled = !this.syncScroll();
    this.syncScroll.set(enabled);
    storeFlag(SYNC_SCROLL_KEY, enabled);
  }

  /** Collapse or expand the notes sidebar. */
  protected toggleSidebar(): void {
    const collapsed = !this.sidebarCollapsed();
    this.sidebarCollapsed.set(collapsed);
    storeFlag(SIDEBAR_COLLAPSED_KEY, collapsed);
  }

  /** Recompute scroll anchors (after each preview render or layout change). */
  protected refreshScrollSync(): void {
    const scroller = this.editor()?.scroller() ?? null;
    const preview = this.previewPane()?.nativeElement;
    if (
      !this.syncScroll() ||
      this.layout() !== 'split' ||
      scroller === null ||
      preview === undefined
    ) {
      this.scrollSync.detach();
      return;
    }
    const tops = this.editor()?.lineTops(this.headings().map((heading) => heading.line)) ?? [];
    this.scrollSync.attach({ editor: scroller, preview, editorHeadingTops: tops });
  }

  /**
   * Restore a previous version (the current text is saved as a version first).
   *
   * @param content - Version content.
   */
  protected async restoreVersion(content: string): Promise<void> {
    const path = this.notePath();
    if (path === null) {
      return;
    }
    await this.autosave.flush();
    await this.history.snapshot(path, true).catch((error: unknown) => {
      this.logger.warn('Could not save the current version before restoring.', error);
    });
    this.onEdit(content);
    this.notify.success('Version restored.');
  }

  /**
   * Embed picked files as preview cards.
   *
   * @param paths - Picked files.
   */
  protected embedFiles(paths: readonly string[]): void {
    const cards = paths.flatMap((path) => {
      const markdown = fileMarkdown(path, splitExtension(fileNameOf(path)).stem, true);
      return markdown === null ? [] : [markdown];
    });
    if (cards.length > 0) {
      this.editor()?.block(cards.join('\n'));
    }
  }

  /** Insert the agenda of the note's day. */
  protected async insertAgenda(): Promise<void> {
    const day = parseLocalDate(this.day()) ?? new Date();
    try {
      const items = await this.activity.feed(AGENDA_SOURCE, {
        start: day,
        end: new Date(day.getTime() + DAY_MS),
      });
      this.editor()?.block(agendaMarkdown(items, this.day()));
    } catch (error) {
      this.notify.warn(
        'Agenda unavailable.',
        messageOf(error) ?? 'Add the Agenda source on the Activity page.',
      );
    }
  }

  /**
   * Export the note with its images.
   *
   * @param format - Format.
   */
  protected async exportNote(format: ExportFormat): Promise<void> {
    const title = splitExtension(fileNameOf(this.notePath() ?? 'post-it')).stem;
    try {
      await this.exporter.export(this.content(), title, format);
    } catch (error) {
      this.notify.error('Export failed.', messageOf(error));
    }
  }

  /**
   * Write a draft, then keep a version and link mentioned entities (best effort).
   *
   * @param draft - Path and content.
   */
  private async save(draft: NoteDraft): Promise<void> {
    await this.files.writeText(draft.path, draft.content, { silent: true });
    this.history.snapshot(draft.path).catch((error: unknown) => {
      this.logger.warn('Note version not saved.', error);
    });
    this.relations.sync(draft.path, draft.content).catch((error: unknown) => {
      this.logger.warn('Note links not synced.', error);
    });
  }

  /**
   * Load a note (pending edits of the previous note are saved first).
   *
   * @param path - Note path, or `null`.
   */
  private async load(path: string | null): Promise<void> {
    await this.autosave.flush();
    this.loaded.set(false);
    this.renaming.set(path === null ? '' : fileNameOf(path));
    if (path === null) {
      this.content.set('');
      return;
    }
    const head = await this.files.textHead(path, MAX_NOTE_BYTES);
    this.content.set(head.text);
    this.autosave.status.set('idle');
    this.loaded.set(!head.truncated);
    if (head.truncated) {
      this.notify.warn('This post-it is too large to edit here.');
      return;
    }
    this.history.snapshot(path, true).catch((error: unknown) => {
      this.logger.warn('Opening version not saved.', error);
    });
  }
}

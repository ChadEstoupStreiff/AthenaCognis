import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import {
  buildSharedPath,
  extensionOf,
  fileNameOf,
  isSharedFilePath,
  parseSharedPath,
} from '@domain/files';
import { formatFileTime, formatLocalDate, parseLocalDate } from '@domain/time';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { AutosaveController } from '../../core/state/autosave';
import { DataSync } from '../../core/state/data-sync.service';
import { viewerCommands } from '../../shared/files/file-row';
import { AiAssistComponent } from '../../shared/ui/ai-assist.component';
import { MarkdownEditorComponent } from '../../shared/ui/markdown-editor.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { persistedWidth } from '../../shared/ui/persisted-width';
import { ResizeHandleComponent } from '../../shared/ui/resize-handle.component';
import { SaveStatusComponent } from '../../shared/ui/save-status.component';

/** Editor layouts. */
type NotesLayout = 'split' | 'edit' | 'preview';

const NOTES_FOLDER = 'notes';
const PREVIEW_WIDTH_KEY = 'ac.notes.previewWidth';
/** No stored width: editor and preview split the space evenly. */
const EVEN_SPLIT = 0;
const NEW_NOTE = '# New note\n\n';
const MAX_NOTE_BYTES = 5_242_880;
const AI_CONTEXT =
  'This is a markdown note: keep markdown formatting, use bullet points and emojis when useful.';
const LAYOUTS = [
  { value: 'edit', icon: 'pi pi-pencil', label: 'Edit' },
  { value: 'split', icon: 'pi pi-pause', label: 'Split' },
  { value: 'preview', icon: 'pi pi-eye', label: 'Preview' },
];

/** Daily Markdown notes with live preview, AI help and autosave. */
@Component({
  selector: 'ac-notes-page',
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    InputTextModule,
    SelectButtonModule,
    TooltipModule,
    AiAssistComponent,
    MarkdownEditorComponent,
    MarkdownViewComponent,
    ResizeHandleComponent,
    SaveStatusComponent,
  ],
  templateUrl: './notes.page.html',
  styleUrl: './notes.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPage {
  private readonly files = inject(FilesApi);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);
  private readonly editor = viewChild(MarkdownEditorComponent);

  /** Query parameter: note being edited. */
  readonly path = input<string | undefined>(undefined);
  /** Query parameter: day shown in the sidebar. */
  readonly date = input<string | undefined>(undefined);
  /** Query parameter: `1` creates a note on arrival (from the New menu or palette). */
  readonly create = input<string | undefined>(undefined);

  protected readonly layouts = LAYOUTS;
  protected readonly layout = signal<NotesLayout>('split');
  protected readonly content = signal('');
  protected readonly loaded = signal(false);
  protected readonly renaming = signal('');
  protected readonly aiContext = AI_CONTEXT;
  protected readonly aiSource = (): string => this.editor()?.selectedText() ?? this.content();
  protected readonly notePath = computed(() => {
    const path = this.path();
    return path !== undefined && isSharedFilePath(path) ? path : null;
  });
  protected readonly day = computed(
    () =>
      this.date() ?? parseSharedPath(this.notePath() ?? '')?.date ?? formatLocalDate(new Date()),
  );
  protected readonly dayDate = computed(() => parseLocalDate(this.day()));
  protected readonly isMarkdown = computed(() =>
    ['md', 'markdown', 'txt'].includes(extensionOf(this.notePath() ?? '')),
  );

  protected readonly notes = resource({
    params: () => ({ day: this.day(), version: this.sync.version('notes')() }),
    loader: ({ params }) => this.files.listFolder(NOTES_FOLDER, params.day, params.day),
  });

  protected readonly previewWidth = persistedWidth(PREVIEW_WIDTH_KEY, EVEN_SPLIT);
  protected readonly autosave = new AutosaveController<{ path: string; content: string }>(
    (value) => this.files.writeText(value.path, value.content, true).then(() => undefined),
    inject(DestroyRef),
  );

  /** Restore the even editor / preview split. */
  protected resetPreviewWidth(): void {
    this.previewWidth.set(EVEN_SPLIT);
  }

  /** Load the note whenever the path changes. */
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
   * Show another day.
   *
   * @param date - Picked date.
   */
  protected pickDay(date: Date | null): void {
    if (date !== null) {
      void this.router.navigate([], {
        queryParams: { date: formatLocalDate(date) },
        queryParamsHandling: 'merge',
      });
    }
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

  /** Create a note for the selected day and open it. */
  protected async createNote(): Promise<void> {
    const path = buildSharedPath({
      date: this.day(),
      folder: NOTES_FOLDER,
      name: `${formatFileTime(new Date())}.md`,
    });
    await this.files.writeText(path, NEW_NOTE);
    this.open(path);
  }

  /** Rename the current note. */
  protected async rename(): Promise<void> {
    const path = this.notePath();
    const name = this.renaming().trim();
    if (path === null || name === '' || name === fileNameOf(path)) {
      return;
    }
    await this.autosave.flush();
    const target = extensionOf(name) === '' ? `${name}.md` : name;
    const newPath = await this.files.move({ path, name: target });
    this.notify.success('Note renamed.');
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
      this.notify.warn('This note is too large to edit here.');
    }
  }
}

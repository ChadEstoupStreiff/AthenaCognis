import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { type CompletionSource, startCompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { ThemeService } from '../../core/theme/theme.service';
import {
  type ImageRef,
  insertBlock,
  type LineMarker,
  setHeading,
  toggleLineMarker,
  wrapSelection,
} from '../text/markdown-format';
import type { TableOperation } from '../text/markdown-table';
import {
  applyEdit,
  type EditorCommand,
  editImage,
  editTable,
  type FileUploader,
  insertFiles,
  insertText,
  lineTop,
  pasteUrlOverSelection,
  revealLine,
  runCommand,
} from './markdown-editor-commands';
import { searchPanel } from './markdown-editor-search';

export type { EditorCommand, FileUploader } from './markdown-editor-commands';

const LINK_PLACEHOLDER = 'link text';
const LINK_SUFFIX = '](https://)';

/** Light theme matching the app surfaces. */
const LIGHT_THEME = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: '100%' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
});

/** Shared editor styling. */
const BASE_THEME = EditorView.theme({
  '&': { fontSize: '14px', height: '100%' },
  '.cm-scroller': {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '12px 0' },
  '&.cm-focused': { outline: 'none' },
});

/**
 * Smallest change turning one text into another (keeps cursor and undo history).
 *
 * @param current - Current text.
 * @param next - Wanted text.
 * @returns Range of `current` to replace and its replacement.
 */
function minimalChange(
  current: string,
  next: string,
): { from: number; to: number; insert: string } {
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current[start] === next[start]) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end += 1;
  }
  return { from: start, to: current.length - end, insert: next.slice(start, next.length - end) };
}

/** CodeMirror 6 Markdown editor (two-way bound text) with formatting commands. */
@Component({
  selector: 'ac-markdown-editor',
  host: { '[attr.data-own-drop]': 'fileUploader() === null ? null : ""' },
  template: `<div #host class="editor"></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .editor {
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditorComponent {
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly theme = inject(ThemeService);
  private readonly themeCompartment = new Compartment();
  private readonly completionCompartment = new Compartment();
  private view: EditorView | null = null;

  /** Document text (two-way). */
  readonly value = model('');
  /** Stores pasted or dropped files; `null` disables file paste. */
  readonly fileUploader = input<FileUploader | null>(null);
  /** Autocompletion sources (mentions, tags, emojis…). */
  readonly completionSources = input<readonly CompletionSource[]>([]);

  /** Create the editor and keep text, theme and completions in sync. */
  constructor() {
    afterNextRender(() => {
      this.view = new EditorView({
        parent: this.host().nativeElement,
        doc: this.value(),
        extensions: this.extensions(),
      });
    });
    effect(() => {
      this.syncDocument(this.value());
    });
    effect(() => {
      this.theme.dark();
      this.view?.dispatch({ effects: this.themeCompartment.reconfigure(this.themeExtension()) });
    });
    effect(() => {
      const extension = this.completionExtension(this.completionSources());
      this.view?.dispatch({ effects: this.completionCompartment.reconfigure(extension) });
    });
    inject(DestroyRef).onDestroy(() => {
      this.view?.destroy();
    });
  }

  /**
   * Currently selected text (whole document when nothing is selected).
   *
   * @returns Text.
   */
  selectedText(): string {
    const view = this.view;
    if (view === null) {
      return this.value();
    }
    const { from, to } = view.state.selection.main;
    return from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to);
  }

  /**
   * Replace the selection (or the whole document when nothing is selected).
   *
   * @param text - Replacement.
   */
  replaceSelection(text: string): void {
    const view = this.view;
    if (view === null) {
      this.value.set(text);
      return;
    }
    const { from, to } = view.state.selection.main;
    const range = from === to ? { from: 0, to: view.state.doc.length } : { from, to };
    view.dispatch({ changes: { ...range, insert: text } });
  }

  /**
   * Wrap the selection in markers (toggles when already wrapped).
   *
   * @param before - Opening marker.
   * @param after - Closing marker.
   * @param placeholder - Text used when nothing is selected.
   */
  wrap(before: string, after: string, placeholder = 'text'): void {
    this.withView((view) => {
      applyEdit(view, (doc, from, to) => wrapSelection(doc, from, to, before, after, placeholder));
    });
  }

  /**
   * Turn the current lines into a heading (0 = paragraph).
   *
   * @param level - Heading level 0–6.
   */
  heading(level: number): void {
    this.withView((view) => {
      applyEdit(view, (doc, from, to) => setHeading(doc, from, to, level));
    });
  }

  /**
   * Toggle a list or quote marker on the current lines.
   *
   * @param marker - Marker.
   */
  lineMarker(marker: LineMarker): void {
    this.withView((view) => {
      applyEdit(view, (doc, from, to) => toggleLineMarker(doc, from, to, marker));
    });
  }

  /**
   * Insert a block (table, rule, code fence) on its own lines.
   *
   * @param block - Block text.
   */
  block(block: string): void {
    this.withView((view) => {
      applyEdit(view, (doc, from, to) => insertBlock(doc, from, to, block));
    });
  }

  /**
   * Insert text at the cursor.
   *
   * @param text - Text.
   */
  insert(text: string): void {
    this.withView((view) => {
      insertText(view, text);
    });
  }

  /**
   * Insert a trigger (`@`, `#`, `[[`…) and open the completion list.
   *
   * @param text - Trigger text.
   */
  insertAndComplete(text: string): void {
    this.withView((view) => {
      const head = view.state.selection.main.head;
      const before = view.state.sliceDoc(Math.max(0, head - 1), head);
      insertText(view, before === '' || /\s/.test(before) ? text : ` ${text}`);
      startCompletion(view);
    });
  }

  /** Wrap the selection in a Markdown link. */
  link(): void {
    this.wrap('[', LINK_SUFFIX, LINK_PLACEHOLDER);
  }

  /**
   * Run undo, redo, indent, outdent or open search.
   *
   * @param command - Command.
   */
  command(command: EditorCommand): void {
    this.withView((view) => {
      runCommand(view, command);
    });
  }

  /**
   * Edit the table under the cursor.
   *
   * @param operation - Operation.
   * @returns `false` when the cursor is not in a table.
   */
  table(operation: TableOperation): boolean {
    return this.view !== null && editTable(this.view, operation);
  }

  /**
   * Resize or caption the image in the selection (or on the cursor line).
   *
   * @param transform - New image from the current one.
   * @returns `false` when no image is selected.
   */
  image(transform: (image: ImageRef) => ImageRef): boolean {
    return this.view !== null && editImage(this.view, transform);
  }

  /**
   * Upload files and insert them at the cursor (images inline, other files as links).
   *
   * @param files - Files.
   */
  async insertFiles(files: readonly File[]): Promise<void> {
    const uploader = this.fileUploader();
    if (this.view !== null && uploader !== null && files.length > 0) {
      await insertFiles(this.view, files, uploader);
    }
  }

  /**
   * Scrollable element of the editor.
   *
   * @returns Scroller, or `null` before the editor exists.
   */
  scroller(): HTMLElement | null {
    return this.view?.scrollDOM ?? null;
  }

  /**
   * Pixel offset of lines in the scroller.
   *
   * @param lines - 1-based line numbers.
   * @returns Offsets.
   */
  lineTops(lines: readonly number[]): number[] {
    const view = this.view;
    return view === null ? [] : lines.map((line) => lineTop(view, line));
  }

  /**
   * Move the cursor to a line and scroll it to the top.
   *
   * @param line - 1-based line number.
   */
  revealLine(line: number): void {
    this.withView((view) => {
      revealLine(view, line);
    });
  }

  /**
   * Run an action when the editor exists.
   *
   * @param action - Action.
   */
  private withView(action: (view: EditorView) => void): void {
    if (this.view !== null) {
      action(this.view);
    }
  }

  /**
   * Upload pasted or dropped files instead of inserting them as text.
   *
   * @param transfer - Data transfer.
   * @param event - Paste or drop event.
   * @returns `true` when the event was handled.
   */
  private handleFileTransfer(transfer: DataTransfer | null, event: Event): boolean {
    const files = Array.from(transfer?.files ?? []);
    if (files.length === 0 || this.fileUploader() === null) {
      return false;
    }
    event.preventDefault();
    void this.insertFiles(files);
    return true;
  }

  /**
   * Paste handler: files are uploaded, a URL over a selection becomes a link.
   *
   * @param event - Clipboard event.
   * @param view - Editor.
   * @returns `true` when handled.
   */
  private handlePaste(event: ClipboardEvent, view: EditorView): boolean {
    if (this.handleFileTransfer(event.clipboardData, event)) {
      return true;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (pasteUrlOverSelection(view, text)) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  /**
   * Drop handler: files are uploaded where they are dropped.
   *
   * @param event - Drag event.
   * @param view - Editor.
   * @returns `true` when handled.
   */
  private handleDrop(event: DragEvent, view: EditorView): boolean {
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position !== null && (event.dataTransfer?.files.length ?? 0) > 0) {
      view.dispatch({ selection: { anchor: position } });
    }
    return this.handleFileTransfer(event.dataTransfer, event);
  }

  /**
   * Accept file drags when files can be uploaded.
   *
   * @param event - Drag event.
   * @returns `false` (CodeMirror keeps its own handling).
   */
  private handleDragOver(event: DragEvent): boolean {
    if (this.fileUploader() !== null && (event.dataTransfer?.types ?? []).includes('Files')) {
      event.preventDefault();
    }
    return false;
  }

  /**
   * Formatting shortcuts, Tab indentation and paste/drop handlers.
   *
   * @returns Extensions.
   */
  private formattingExtensions(): Extension[] {
    const run =
      (action: () => void): (() => boolean) =>
      () => {
        action();
        return true;
      };
    return [
      Prec.high(
        keymap.of([
          {
            key: 'Mod-b',
            run: run(() => {
              this.wrap('**', '**');
            }),
          },
          {
            key: 'Mod-i',
            run: run(() => {
              this.wrap('*', '*');
            }),
          },
          {
            key: 'Mod-k',
            run: run(() => {
              this.link();
            }),
          },
          indentWithTab,
        ]),
      ),
      EditorView.domEventHandlers({
        paste: (event, view) => this.handlePaste(event, view),
        drop: (event, view) => this.handleDrop(event, view),
        dragover: (event) => this.handleDragOver(event),
      }),
    ];
  }

  /**
   * Language data registering the completion sources.
   *
   * @param sources - Sources.
   * @returns Extension.
   */
  private completionExtension(sources: readonly CompletionSource[]): Extension {
    return EditorState.languageData.of(() => sources.map((autocomplete) => ({ autocomplete })));
  }

  /**
   * Editor extensions.
   *
   * @returns Extensions.
   */
  private extensions(): Extension[] {
    return [
      basicSetup,
      markdown({ codeLanguages: languages }),
      EditorView.lineWrapping,
      BASE_THEME,
      ...searchPanel(),
      ...this.formattingExtensions(),
      this.themeCompartment.of(this.themeExtension()),
      this.completionCompartment.of(this.completionExtension(this.completionSources())),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.value.set(update.state.doc.toString());
        }
      }),
    ];
  }

  /**
   * Theme extension for the current mode.
   *
   * @returns Light or dark theme.
   */
  private themeExtension(): Extension {
    return this.theme.dark() ? oneDark : LIGHT_THEME;
  }

  /**
   * Apply an outside change of the bound value with the smallest edit.
   *
   * @param text - New value.
   */
  private syncDocument(text: string): void {
    const view = this.view;
    const current = view?.state.doc.toString();
    if (view !== null && current !== undefined && current !== text) {
      view.dispatch({ changes: minimalChange(current, text) });
    }
  }
}

import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  model,
  viewChild,
} from '@angular/core';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Compartment, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { ThemeService } from '../../core/theme/theme.service';

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

/** CodeMirror 6 Markdown editor (two-way bound text). */
@Component({
  selector: 'ac-markdown-editor',
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
  private view: EditorView | null = null;

  /** Document text (two-way). */
  readonly value = model('');

  /** Create the editor and keep text and theme in sync. */
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
      this.themeCompartment.of(this.themeExtension()),
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
   * Replace the document when the bound value changed from outside.
   *
   * @param text - New value.
   */
  private syncDocument(text: string): void {
    const view = this.view;
    if (view !== null && view.state.doc.toString() !== text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }
  }
}

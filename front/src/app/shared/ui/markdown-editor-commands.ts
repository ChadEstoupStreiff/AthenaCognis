import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { isEmbeddableImage } from '@domain/files';
import {
  imageMarkdown,
  parseImage,
  renderImage,
  type ImageRef,
  type TextEdit,
} from '../text/markdown-format';
import {
  applyTableOperation,
  findTable,
  formatTable,
  type TableOperation,
} from '../text/markdown-table';

/** Stores a file and resolves to its URL. */
export type FileUploader = (file: File) => Promise<string>;

/** History, indentation and search commands exposed to toolbars. */
export type EditorCommand = 'undo' | 'redo' | 'indent' | 'outdent' | 'search';

const COMMANDS: Readonly<Record<EditorCommand, (view: EditorView) => boolean>> = {
  undo,
  redo,
  indent: indentMore,
  outdent: indentLess,
  search: openSearchPanel,
};

const URL_PATTERN = /^https?:\/\/\S+$/;

/**
 * Run a built-in command and refocus the editor.
 *
 * @param view - Editor.
 * @param command - Command.
 */
export function runCommand(view: EditorView, command: EditorCommand): void {
  COMMANDS[command](view);
  view.focus();
}

/**
 * Compute an edit from the document and main selection, apply it and refocus.
 *
 * @param view - Editor.
 * @param build - Edit builder.
 */
export function applyEdit(
  view: EditorView,
  build: (doc: string, from: number, to: number) => TextEdit,
): void {
  const { from, to } = view.state.selection.main;
  const edit = build(view.state.doc.toString(), from, to);
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.selectFrom, head: edit.selectTo },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Insert text at the cursor (replacing the selection), cursor after it.
 *
 * @param view - Editor.
 * @param text - Text.
 */
export function insertText(view: EditorView, text: string): void {
  applyEdit(view, (_doc, from, to) => ({
    from,
    to,
    insert: text,
    selectFrom: from + text.length,
    selectTo: from + text.length,
  }));
}

/**
 * Edit the table under the cursor and re-align its pipes.
 *
 * @param view - Editor.
 * @param operation - Operation.
 * @returns `false` when the cursor is not in a table.
 */
export function editTable(view: EditorView, operation: TableOperation): boolean {
  const found = findTable(view.state.doc.toString(), view.state.selection.main.head);
  if (found === null) {
    return false;
  }
  const insert = formatTable(applyTableOperation(found.table, found.row, found.column, operation));
  const cursor = Math.min(view.state.selection.main.head, found.from + insert.length);
  view.dispatch({
    changes: { from: found.from, to: found.to, insert },
    selection: { anchor: cursor },
  });
  view.focus();
  return true;
}

/**
 * Rewrite the image in the selection (or on the cursor line).
 *
 * @param view - Editor.
 * @param transform - New image from the current one.
 * @returns `false` when no single image is selected.
 */
export function editImage(view: EditorView, transform: (image: ImageRef) => ImageRef): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const range = selection.empty ? { from: line.from, to: line.to } : selection;
  const image = parseImage(view.state.sliceDoc(range.from, range.to));
  if (image === null) {
    return false;
  }
  const insert = renderImage(transform(image));
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from, head: range.from + insert.length },
  });
  view.focus();
  return true;
}

/**
 * Replace the first occurrence of a text (the user may have moved it).
 *
 * @param view - Editor.
 * @param search - Text to find.
 * @param insert - Replacement.
 */
function replaceText(view: EditorView, search: string, insert: string): void {
  const index = view.state.doc.toString().indexOf(search);
  if (index !== -1) {
    view.dispatch({ changes: { from: index, to: index + search.length, insert } });
  }
}

/**
 * Markdown pointing to an uploaded file: an image, or a link for other files.
 *
 * @param file - File.
 * @param url - Stored URL.
 * @returns Markdown.
 */
function uploadedMarkdown(file: File, url: string): string {
  const image = imageMarkdown(file.name, url);
  return isEmbeddableImage(file) ? image : image.slice(1);
}

/**
 * Upload files one by one behind placeholders, then insert their Markdown.
 *
 * @param view - Editor.
 * @param files - Files.
 * @param uploader - Upload function (reports its own errors).
 */
export async function insertFiles(
  view: EditorView,
  files: readonly File[],
  uploader: FileUploader,
): Promise<void> {
  for (const file of files) {
    const placeholder = `[Uploading ${file.name}…]()`;
    insertText(view, placeholder);
    try {
      replaceText(view, placeholder, uploadedMarkdown(file, await uploader(file)));
    } catch {
      replaceText(view, placeholder, '');
    }
  }
}

/**
 * Wrap the selection in a link when a URL is pasted over it.
 *
 * @param view - Editor.
 * @param text - Pasted text.
 * @returns `true` when handled.
 */
export function pasteUrlOverSelection(view: EditorView, text: string): boolean {
  const url = text.trim();
  const selection = view.state.selection.main;
  if (selection.empty || !URL_PATTERN.test(url)) {
    return false;
  }
  const label = view.state.sliceDoc(selection.from, selection.to);
  if (URL_PATTERN.test(label.trim())) {
    return false;
  }
  const insert = `[${label}](${url})`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
  });
  return true;
}

/**
 * Offset of a line in the scrollable editor content.
 *
 * @param view - Editor.
 * @param line - 1-based line number.
 * @returns Pixel offset from the top of the scroller content.
 */
export function lineTop(view: EditorView, line: number): number {
  const safeLine = Math.min(Math.max(line, 1), view.state.doc.lines);
  return view.lineBlockAt(view.state.doc.line(safeLine).from).top + view.documentPadding.top;
}

/**
 * Put the cursor on a line and smoothly scroll it to the top.
 *
 * @param view - Editor.
 * @param line - 1-based line number.
 */
export function revealLine(view: EditorView, line: number): void {
  const safeLine = Math.min(Math.max(line, 1), view.state.doc.lines);
  view.dispatch({ selection: { anchor: view.state.doc.line(safeLine).from } });
  view.scrollDOM.scrollTo({ top: lineTop(view, safeLine), behavior: 'smooth' });
  view.contentDOM.focus({ preventScroll: true });
}

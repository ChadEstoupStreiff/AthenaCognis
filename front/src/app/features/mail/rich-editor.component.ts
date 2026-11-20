import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  HostListener,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import {
  fitWithin,
  isBlankContent,
  mailReadyHtml,
  sanitizeMailHtml,
  SELECTED_IMAGE_CLASS,
} from './rich-text';

/** Text sizes offered (values of the `fontSize` command, 3 = default). */
const FONT_SIZES = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '6' },
] as const;
const DEFAULT_FONT_SIZE = '3';
/** Widths offered for a selected inline image. */
const IMAGE_WIDTHS = ['25%', '50%', '75%', '100%'] as const;
/** Formats whose on/off state is shown on the toolbar. */
const TOGGLE_COMMANDS = [
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'insertUnorderedList',
  'insertOrderedList',
] as const;
type ToggleCommand = (typeof TOGGLE_COMMANDS)[number];
const JPEG_QUALITY = 0.9;
/** Narrowest width an image can be dragged to (px). */
const MIN_IMAGE_WIDTH = 24;
/** Tallest resize bar (px); shorter images get a bar of HANDLE_RATIO of their height. */
const MAX_HANDLE_HEIGHT = 48;
const HANDLE_RATIO = 0.6;
const HALF = 2;

/** Resize bar position inside the editor frame (px). */
interface HandleBox {
  readonly left: number;
  readonly top: number;
  readonly height: number;
}

/** Image being resized by dragging its bar. */
interface ResizeDrag {
  readonly image: HTMLImageElement;
  readonly startX: number;
  readonly startWidth: number;
}
/** Image types kept lossless when scaled down. */
const LOSSLESS_TYPES = new Set(['image/png', 'image/gif']);

/** Toolbar button: command run on click. */
interface ToolButton {
  readonly command: string;
  /** PrimeIcons class, empty when a letter is shown instead. */
  readonly icon: string;
  readonly label: string;
  /** Letter shown when PrimeIcons has no icon for the format. */
  readonly glyph?: string;
}

const FORMAT_BUTTONS: readonly ToolButton[] = [
  { command: 'bold', icon: '', glyph: 'B', label: 'Bold (Ctrl+B)' },
  { command: 'italic', icon: '', glyph: 'I', label: 'Italic (Ctrl+I)' },
  { command: 'underline', icon: '', glyph: 'U', label: 'Underline (Ctrl+U)' },
  { command: 'strikeThrough', icon: '', glyph: 'S', label: 'Strikethrough' },
];
const BLOCK_BUTTONS: readonly ToolButton[] = [
  { command: 'insertUnorderedList', icon: 'pi pi-list', label: 'Bulleted list' },
  { command: 'insertOrderedList', icon: 'pi pi-sort-numeric-down', label: 'Numbered list' },
  { command: 'justifyLeft', icon: 'pi pi-align-left', label: 'Align left' },
  { command: 'justifyCenter', icon: 'pi pi-align-center', label: 'Center' },
  { command: 'justifyRight', icon: 'pi pi-align-right', label: 'Align right' },
];

/** Content written in the editor. */
export interface RichContent {
  /** HTML, empty when nothing was written. */
  readonly html: string;
  /** Visible text (plain text part of the mail). */
  readonly text: string;
}

/**
 * Run an editing command on the current selection.
 *
 * `execCommand` is deprecated but has no replacement for contenteditable editing,
 * and its output (`<b>`, `<font>`, `<ul>`) is what mail clients render best.
 *
 * @param command - Command name.
 * @param value - Command value.
 */
function execute(command: string, value?: string): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
  document.execCommand(command, false, value);
}

/**
 * Tell whether a format is on at the caret.
 *
 * @param command - Toggle command.
 * @returns True when on.
 */
function isOn(command: ToggleCommand): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- see execute()
  return document.queryCommandState(command);
}

/**
 * Read a file as a data URL.
 *
 * @param file - File.
 * @returns Data URL.
 */
function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = (): void => {
      reject(reader.error ?? new Error('Cannot read image'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Load an image file in an element (to know its size).
 *
 * @param url - Object or data URL.
 * @returns Loaded image.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => {
      resolve(image);
    };
    image.onerror = (): void => {
      reject(new Error('Not a readable image'));
    };
    image.src = url;
  });
}

/**
 * Data URL of an image file, scaled down when wider than the mail limit.
 *
 * @param file - Image file.
 * @returns Data URL to embed.
 */
async function imageDataUrl(file: File): Promise<string> {
  const original = await readDataUrl(file);
  if (file.type === 'image/gif') {
    return original;
  }
  const image = await loadImage(original);
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const size = fitWithin(natural);
  if (size.width === natural.width) {
    return original;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')?.drawImage(image, 0, 0, size.width, size.height);
  const type = LOSSLESS_TYPES.has(file.type) ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(type, JPEG_QUALITY);
}

/**
 * Image files of a clipboard or drop.
 *
 * @param data - Transferred data.
 * @returns Image files, empty when none.
 */
function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/** Mail body editor: formatting toolbar and inline images (pasted, dropped or picked). */
@Component({
  selector: 'ac-mail-rich-editor',
  imports: [NgTemplateOutlet, FormsModule, ButtonModule, SelectModule, TooltipModule],
  template: `
    <div class="toolbar" role="toolbar" aria-label="Formatting" (mousedown)="keepSelection($event)">
      @for (tool of formatButtons; track tool.command) {
        <ng-container [ngTemplateOutlet]="toolButton" [ngTemplateOutletContext]="{ tool }" />
      }
      <span class="separator"></span>
      <p-select
        [options]="fontSizes"
        optionLabel="label"
        optionValue="value"
        [ngModel]="fontSize()"
        (ngModelChange)="setFontSize($event)"
        size="small"
        appendTo="body"
        ariaLabel="Text size"
      />
      <label class="color" pTooltip="Text color" tooltipPosition="top">
        <i class="pi pi-palette" aria-hidden="true"></i>
        <input type="color" aria-label="Text color" (input)="setColor($event)" />
      </label>
      <span class="separator"></span>
      @for (tool of blockButtons; track tool.command) {
        <ng-container [ngTemplateOutlet]="toolButton" [ngTemplateOutletContext]="{ tool }" />
      }
      <span class="separator"></span>
      <p-button
        icon="pi pi-link"
        severity="secondary"
        [text]="true"
        size="small"
        ariaLabel="Insert link"
        pTooltip="Insert link"
        tooltipPosition="top"
        (onClick)="insertLink()"
      />
      <p-button
        icon="pi pi-image"
        severity="secondary"
        [text]="true"
        size="small"
        ariaLabel="Insert image"
        pTooltip="Insert image (or paste / drop one)"
        tooltipPosition="top"
        (onClick)="picker.click()"
      />
      <input #picker type="file" accept="image/*" multiple hidden (change)="onPicked($event)" />
      <p-button
        icon="pi pi-eraser"
        severity="secondary"
        [text]="true"
        size="small"
        ariaLabel="Clear formatting"
        pTooltip="Clear formatting"
        tooltipPosition="top"
        (onClick)="run('removeFormat')"
      />
      @if (selectedImage()) {
        <span class="separator"></span>
        <span class="image-sizes" aria-label="Image width">
          @for (width of imageWidths; track width) {
            <p-button
              [label]="width"
              severity="secondary"
              [text]="true"
              size="small"
              (onClick)="resizeImage(width)"
            />
          }
        </span>
      }
    </div>
    <div #frame class="frame">
      <div
        #editor
        class="editor"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        [attr.data-placeholder]="placeholder()"
        (input)="emit()"
        (paste)="onPaste($event)"
        (drop)="onDrop($event)"
        (click)="onClick($event)"
        (keyup)="refreshState()"
        (scroll)="positionHandle()"
      ></div>
      @if (handle(); as box) {
        <div
          class="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize image"
          [style.left.px]="box.left"
          [style.top.px]="box.top"
          [style.height.px]="box.height"
          (pointerdown)="startResize($event)"
          (pointermove)="onResize($event)"
          (pointerup)="endResize()"
          (pointercancel)="endResize()"
        ></div>
      }
    </div>

    <ng-template #toolButton let-tool="tool">
      <p-button
        [icon]="tool.icon"
        severity="secondary"
        [text]="!active().has(tool.command)"
        [outlined]="active().has(tool.command)"
        size="small"
        [ariaLabel]="tool.label"
        [pTooltip]="tool.label"
        tooltipPosition="top"
        (onClick)="run(tool.command)"
      >
        @if (tool.glyph) {
          <span class="glyph" [class]="'glyph glyph-' + tool.command" aria-hidden="true">{{
            tool.glyph
          }}</span>
        }
      </p-button>
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--ac-panel-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
      border-bottom: 1px solid var(--ac-panel-border);
    }
    .separator {
      width: 1px;
      height: 20px;
      margin: 0 4px;
      background: var(--ac-panel-border);
    }
    .color {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      cursor: pointer;
      input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }
    .glyph {
      display: inline-block;
      width: 1rem;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 15px;
      line-height: 1;
      text-align: center;
    }
    .glyph-bold {
      font-weight: 700;
    }
    .glyph-italic {
      font-style: italic;
    }
    .glyph-underline {
      text-decoration: underline;
    }
    .glyph-strikeThrough {
      text-decoration: line-through;
    }
    .image-sizes {
      display: inline-flex;
    }
    .frame {
      position: relative;
      overflow: hidden;
    }
    .resize-handle {
      position: absolute;
      width: 8px;
      margin-left: -4px;
      border: 1px solid #fff;
      border-radius: 4px;
      background: var(--p-primary-color);
      cursor: ew-resize;
      touch-action: none;
    }
    .editor :is(font[size='1']) {
      font-size: 10px;
    }
    .editor :is(font[size='2']) {
      font-size: 12px;
    }
    .editor :is(font[size='3']) {
      font-size: 14px;
    }
    .editor :is(font[size='4']) {
      font-size: 16px;
    }
    .editor :is(font[size='5']) {
      font-size: 20px;
    }
    .editor :is(font[size='6']) {
      font-size: 28px;
    }
    .editor :is(font[size='7']) {
      font-size: 40px;
    }
    .editor {
      min-height: 240px;
      max-height: 55vh;
      padding: 10px 12px;
      overflow: auto;
      outline: none;
      font-size: 14px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .editor:empty::before {
      content: attr(data-placeholder);
      color: var(--ac-muted);
      pointer-events: none;
    }
    .editor :is(img) {
      max-width: 100%;
      height: auto;
      cursor: pointer;
    }
    .editor :is(img.selected) {
      outline: 2px solid var(--p-primary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailRichEditorComponent {
  /** HTML shown (loaded when it differs from what the editor last emitted). */
  readonly html = input('');
  readonly placeholder = input('');
  /** Written content after each change. */
  readonly contentChange = output<RichContent>();
  /** Files that are not images, dropped or pasted: attach them instead. */
  readonly filesDropped = output<File[]>();

  protected readonly formatButtons = FORMAT_BUTTONS;
  protected readonly blockButtons = BLOCK_BUTTONS;
  protected readonly fontSizes = [...FONT_SIZES];
  protected readonly imageWidths = IMAGE_WIDTHS;
  protected readonly active = signal<ReadonlySet<string>>(new Set());
  protected readonly fontSize = signal<string>(DEFAULT_FONT_SIZE);
  protected readonly selectedImage = signal<HTMLImageElement | null>(null);
  /** Resize bar at the right edge of the selected image, null when none. */
  protected readonly handle = signal<HandleBox | null>(null);
  private readonly frame = viewChild.required<ElementRef<HTMLDivElement>>('frame');
  private drag: ResizeDrag | null = null;

  private readonly editor = viewChild.required<ElementRef<HTMLDivElement>>('editor');
  /** HTML last emitted: an input equal to it is our own echo, not a new value. */
  private lastHtml: string | null = null;
  /** Selection inside the editor, restored after toolbar controls took focus. */
  private savedRange: Range | null = null;

  /** Load the input HTML when it changes from outside (draft, AI reply). */
  constructor() {
    effect(() => {
      const html = this.html();
      const element = this.editor().nativeElement;
      if (html !== this.lastHtml) {
        element.innerHTML = sanitizeMailHtml(html);
        this.lastHtml = html;
        this.selectedImage.set(null);
        this.handle.set(null);
      }
    });
  }

  /** Remember the selection while it is inside the editor. */
  @HostListener('document:selectionchange')
  protected onSelectionChange(): void {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (this.editor().nativeElement.contains(range.commonAncestorContainer)) {
      this.savedRange = range.cloneRange();
      this.refreshState();
    }
  }

  /**
   * Keep the editor selection when a toolbar button is pressed.
   *
   * @param event - Mouse down on the toolbar.
   */
  protected keepSelection(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('button') !== null) {
      event.preventDefault();
    }
  }

  /**
   * Run a toolbar command on the editor selection, then emit the change.
   *
   * @param command - Command name.
   * @param value - Command value.
   */
  protected run(command: string, value?: string): void {
    this.restoreSelection();
    execute('styleWithCSS', 'false');
    execute(command, value);
    this.emit();
    this.refreshState();
  }

  /**
   * Change the size of the selected text.
   *
   * @param size - `fontSize` value.
   */
  protected setFontSize(size: string): void {
    this.fontSize.set(size);
    this.run('fontSize', size);
  }

  /**
   * Color the selected text.
   *
   * @param event - Color input event.
   */
  protected setColor(event: Event): void {
    this.run('foreColor', (event.target as HTMLInputElement).value);
  }

  /** Turn the selection into a link (asks for the address). */
  protected insertLink(): void {
    const url = globalThis.prompt('Link address', 'https://')?.trim();
    if (url && url !== 'https://') {
      this.run('createLink', url);
    }
  }

  /**
   * Insert images picked in the file dialog.
   *
   * @param event - File input change.
   */
  protected async onPicked(event: Event): Promise<void> {
    const picker = event.target as HTMLInputElement;
    await this.insertImages(imageFiles({ files: picker.files } as DataTransfer));
    picker.value = '';
  }

  /**
   * Paste images inline and pasted HTML cleaned.
   *
   * @param event - Paste event.
   */
  protected async onPaste(event: ClipboardEvent): Promise<void> {
    const images = imageFiles(event.clipboardData);
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (images.length > 0) {
      event.preventDefault();
      await this.insertImages(images);
    } else if (html !== '') {
      event.preventDefault();
      this.run('insertHTML', sanitizeMailHtml(html));
    }
  }

  /**
   * Insert dropped images inline; hand other files over as attachments.
   *
   * @param event - Drop event.
   */
  protected async onDrop(event: DragEvent): Promise<void> {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const images = imageFiles(event.dataTransfer);
    const others = files.filter((file) => !images.includes(file));
    if (others.length > 0) {
      this.filesDropped.emit(others);
    }
    await this.insertImages(images);
  }

  /**
   * Select an image on click (offers widths), unselect otherwise.
   *
   * @param event - Click in the editor.
   */
  protected onClick(event: MouseEvent): void {
    this.selectedImage()?.classList.remove(SELECTED_IMAGE_CLASS);
    const target = event.target;
    const image = target instanceof HTMLImageElement ? target : null;
    image?.classList.add(SELECTED_IMAGE_CLASS);
    this.selectedImage.set(image);
    this.positionHandle();
  }

  /** Put the resize bar on the right edge of the selected image (hide it when none). */
  @HostListener('window:resize')
  protected positionHandle(): void {
    const image = this.selectedImage();
    if (!image?.isConnected) {
      this.handle.set(null);
      return;
    }
    const frame = this.frame().nativeElement.getBoundingClientRect();
    const box = image.getBoundingClientRect();
    const height = Math.min(MAX_HANDLE_HEIGHT, box.height * HANDLE_RATIO);
    this.handle.set({
      left: box.right - frame.left,
      top: box.top - frame.top + (box.height - height) / HALF,
      height,
    });
  }

  /**
   * Start dragging the resize bar.
   *
   * @param event - Pointer down on the bar.
   */
  protected startResize(event: PointerEvent): void {
    const image = this.selectedImage();
    if (image === null) {
      return;
    }
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = { image, startX: event.clientX, startWidth: image.getBoundingClientRect().width };
  }

  /**
   * Resize the image while the bar is dragged (within the editor width).
   *
   * @param event - Pointer move.
   */
  protected onResize(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null) {
      return;
    }
    const editor = this.editor().nativeElement;
    const padding = Number.parseFloat(getComputedStyle(editor).paddingLeft) * HALF;
    const maxWidth = editor.clientWidth - padding;
    const wanted = drag.startWidth + event.clientX - drag.startX;
    const width = Math.round(Math.min(maxWidth, Math.max(MIN_IMAGE_WIDTH, wanted)));
    drag.image.style.width = `${String(width)}px`;
    drag.image.style.height = 'auto';
    drag.image.setAttribute('width', String(width));
    this.positionHandle();
  }

  /** Finish a resize and emit the new content. */
  protected endResize(): void {
    if (this.drag === null) {
      return;
    }
    this.drag = null;
    this.emit();
  }

  /**
   * Set the width of the selected image (relative to the mail width).
   *
   * @param width - CSS width.
   */
  protected resizeImage(width: string): void {
    const image = this.selectedImage();
    if (image === null) {
      return;
    }
    image.style.width = width;
    image.style.height = 'auto';
    image.removeAttribute('width');
    this.emit();
    this.positionHandle();
  }

  /** Emit the current content (empty HTML when nothing is written). */
  protected emit(): void {
    const element = this.editor().nativeElement;
    const text = element.innerText;
    const html = mailReadyHtml(element);
    this.lastHtml = isBlankContent(text, html) ? '' : html;
    this.contentChange.emit({ html: this.lastHtml, text });
    this.positionHandle();
  }

  /** Show which formats are on at the caret. */
  protected refreshState(): void {
    this.active.set(new Set(TOGGLE_COMMANDS.filter((command) => isOn(command))));
  }

  /**
   * Insert images at the caret, scaled down when too wide.
   *
   * @param files - Image files.
   */
  private async insertImages(files: readonly File[]): Promise<void> {
    for (const file of files) {
      const url = await imageDataUrl(file);
      this.run('insertHTML', `<img src="${url}" alt="" style="max-width:100%;height:auto">`);
    }
  }

  /** Put back the last editor selection (or the caret at the end). */
  private restoreSelection(): void {
    const element = this.editor().nativeElement;
    element.focus();
    const selection = document.getSelection();
    if (selection === null) {
      return;
    }
    let range = this.savedRange;
    if (range === null) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

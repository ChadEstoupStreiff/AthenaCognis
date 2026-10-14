import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import type { FileMetadata, OcrBox } from '@domain/contracts';
import {
  type FileKind,
  fileKindOf,
  fileNameOf,
  type RenderableKind,
  renderableKindOf,
} from '@domain/files';
import { FilesApi, triggerDownload } from '../../../core/files/files.api';
import { SettingsStore } from '../../../core/settings/settings.store';
import { formatBytes } from '../../pipes/bytes.pipe';
import { FileThumbnailComponent } from '../file-thumbnail.component';
import { ArchiveRendererComponent } from './archive-renderer.component';
import { ImageRendererComponent } from './image-renderer.component';
import { PageRendererComponent } from './page-renderer.component';
import { PdfRendererComponent } from './pdf-renderer.component';
import { TableRendererComponent } from './table-renderer.component';
import { type TextDisplay, TextRendererComponent } from './text-renderer.component';
import { TiffRendererComponent } from './tiff-renderer.component';

/** Kinds read fully into memory (subject to the size limit setting). */
const IN_MEMORY_KINDS: ReadonlySet<FileKind> = new Set([
  'markdown',
  'json',
  'code',
  'text',
  'html',
  'table',
  'tiff',
]);
const BYTES_PER_MB = 1_048_576;
const VIEW_KEY_PREFIX = 'ac.renderer.view.';
const VIEW_OPTIONS = [
  { value: 'rendered', label: 'Rendered', icon: 'pi pi-eye' },
  { value: 'source', label: 'Source', icon: 'pi pi-code' },
] as const;

/** Markdown, HTML and SVG: rendered, or their source code. */
export type SourceView = (typeof VIEW_OPTIONS)[number]['value'];

/**
 * Last view picked for a format in this browser (rendered by default).
 *
 * @param kind - Renderable format.
 * @returns View.
 */
function storedView(kind: RenderableKind): SourceView {
  try {
    return localStorage.getItem(VIEW_KEY_PREFIX + kind) === 'source' ? 'source' : 'rendered';
  } catch {
    return 'rendered';
  }
}

/**
 * Remember the view picked for a format.
 *
 * @param kind - Renderable format.
 * @param view - View.
 */
function storeView(kind: RenderableKind, view: SourceView): void {
  try {
    localStorage.setItem(VIEW_KEY_PREFIX + kind, view);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
}

/** Renders any file by kind, with a size gate for large in-memory formats. */
@Component({
  selector: 'ac-file-renderer',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    SelectButtonModule,
    FileThumbnailComponent,
    ArchiveRendererComponent,
    ImageRendererComponent,
    PageRendererComponent,
    PdfRendererComponent,
    TableRendererComponent,
    TextRendererComponent,
    TiffRendererComponent,
  ],
  templateUrl: './file-renderer.component.html',
  styleUrl: './file-renderer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileRendererComponent {
  private readonly files = inject(FilesApi);
  private readonly settings = inject(SettingsStore);

  /** Shared path. */
  readonly path = input.required<string>();
  /** Metadata when already loaded (fetched otherwise). */
  readonly metadata = input<FileMetadata | null | undefined>(undefined);
  /** Smaller frames (drawer). */
  readonly compact = input(false);
  /** OCR boxes for images. */
  readonly ocrBoxes = input<readonly OcrBox[]>([]);
  /** Show OCR boxes. */
  readonly showBoxes = input(false);
  /** Show OCR confidences. */
  readonly showScores = input(false);

  private readonly loadedMetadata = resource({
    params: () => (this.metadata() === undefined ? this.path() : undefined),
    loader: ({ params }) => this.files.metadata(params),
  });

  protected readonly meta = computed(() => this.metadata() ?? this.loadedMetadata.value() ?? null);
  protected readonly kind = computed(() => fileKindOf(this.path(), this.meta()?.mime_type));
  protected readonly contentUrl = computed(() => this.files.contentUrl(this.path()));
  protected readonly display = linkedSignal<string, TextDisplay>({
    source: this.path,
    computation: () => 'auto',
  });
  protected readonly forced = linkedSignal({ source: this.path, computation: () => false });
  protected readonly name = computed(() => fileNameOf(this.path()));
  protected readonly renderable = computed(() => renderableKindOf(this.path(), this.kind()));
  protected readonly view = linkedSignal<RenderableKind | null, SourceView>({
    source: this.renderable,
    computation: (kind) => (kind === null ? 'rendered' : storedView(kind)),
  });
  protected readonly viewOptions = [...VIEW_OPTIONS];

  protected readonly gated = computed(() => {
    const limitMb = this.settings.get('auto_display_file_size_limit');
    const size = this.meta()?.size ?? 0;
    return (
      !this.forced() &&
      limitMb > 0 &&
      IN_MEMORY_KINDS.has(this.kind()) &&
      size > limitMb * BYTES_PER_MB
    );
  });

  protected readonly sizeLabel = computed(() => formatBytes(this.meta()?.size));

  /**
   * Switch between the rendered file and its source (remembered per format).
   *
   * @param view - View.
   */
  protected setView(view: SourceView): void {
    this.view.set(view);
    const kind = this.renderable();
    if (kind !== null) {
      storeView(kind, view);
    }
  }

  /** Download the file. */
  protected download(): void {
    triggerDownload(this.files.contentUrl(this.path(), 'attachment'));
  }
}

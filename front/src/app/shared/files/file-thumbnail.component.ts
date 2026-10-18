import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { fileKindOf, renderableKindOf } from '@domain/files';
import { FilesApi } from '../../core/files/files.api';
import { Previews } from '../../core/files/previews';
import { InViewDirective } from '../directives/in-view.directive';
import { MarkdownViewComponent } from '../ui/markdown-view.component';
import { toFileRow } from './file-row';

/** Loaded preview content. */
type Thumbnail =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'page'; readonly url: SafeResourceUrl }
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' };

const RETRY_MS = 6_000;
const MAX_RETRIES = 3;
const TEXT_SNIPPET = 900;

/**
 * Lazy thumbnail of a file: backend preview image, rendered Markdown, SVG drawing,
 * scaled-down HTML page (sandboxed, no scripts), text snippet, or icon fallback.
 */
@Component({
  selector: 'ac-file-thumbnail',
  imports: [InViewDirective, MarkdownViewComponent],
  template: `
    <div class="thumb" (acInView)="load()">
      @switch (thumbnail().kind) {
        @case ('image') {
          <img
            [src]="imageUrl()"
            [class.drawing]="renderable() === 'svg'"
            alt=""
            loading="lazy"
            decoding="async"
          />
        }
        @case ('page') {
          <iframe
            class="page"
            [src]="pageUrl()"
            sandbox=""
            tabindex="-1"
            loading="lazy"
            aria-hidden="true"
            title="Preview"
          ></iframe>
        }
        @case ('markdown') {
          <ac-markdown-view class="markdown" [source]="snippet()" />
        }
        @case ('text') {
          <pre class="snippet">{{ snippet() }}</pre>
        }
        @default {
          <i [class]="icon()" aria-hidden="true"></i>
          @if (thumbnail().kind === 'pending') {
            <span class="pending">Preview in progress…</span>
          }
        }
      }
    </div>
  `,
  styleUrl: './file-thumbnail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileThumbnailComponent {
  private readonly previews = inject(Previews);
  private readonly files = inject(FilesApi);
  private readonly sanitizer = inject(DomSanitizer);
  private retries = 0;
  private started = false;
  private objectUrl: string | null = null;

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly thumbnail = signal<Thumbnail>({ kind: 'none' });
  protected readonly icon = computed(() => toFileRow(this.path()).icon);
  protected readonly imageUrl = computed(() => {
    const thumbnail = this.thumbnail();
    return thumbnail.kind === 'image' ? thumbnail.url : '';
  });
  protected readonly pageUrl = computed(() => {
    const thumbnail = this.thumbnail();
    return thumbnail.kind === 'page' ? thumbnail.url : null;
  });
  protected readonly snippet = computed(() => {
    const thumbnail = this.thumbnail();
    return thumbnail.kind === 'text' || thumbnail.kind === 'markdown' ? thumbnail.text : '';
  });
  protected readonly renderable = computed(() =>
    renderableKindOf(this.path(), fileKindOf(this.path())),
  );

  /** Release the object URL on destroy. */
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.objectUrl !== null) {
        URL.revokeObjectURL(this.objectUrl);
      }
    });
  }

  /** Fetch the preview once the card is visible. */
  protected async load(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    if (!this.showPageItself()) {
      await this.fetchPreview();
    }
  }

  /**
   * Draw SVGs and HTML pages from the file itself (backend previews are text dumps).
   *
   * @returns `true` when the thumbnail is set.
   */
  private showPageItself(): boolean {
    const url = this.files.contentUrl(this.path());
    switch (this.renderable()) {
      case 'svg':
        this.thumbnail.set({ kind: 'image', url });
        return true;
      case 'html':
        this.thumbnail.set({
          kind: 'page',
          url: this.sanitizer.bypassSecurityTrustResourceUrl(url),
        });
        return true;
      case 'markdown':
      case null:
        return false;
    }
  }

  /** Fetch the preview, retrying while the backend generates it. */
  private async fetchPreview(): Promise<void> {
    try {
      const result = await this.previews.load(this.path());
      switch (result.kind) {
        case 'image':
          this.objectUrl = URL.createObjectURL(result.blob);
          this.thumbnail.set({ kind: 'image', url: this.objectUrl });
          return;
        case 'text':
          this.thumbnail.set({
            kind: this.renderable() === 'markdown' ? 'markdown' : 'text',
            text: result.text.slice(0, TEXT_SNIPPET),
          });
          return;
        case 'pending':
          this.retryLater();
          return;
        case 'none':
          this.thumbnail.set({ kind: 'none' });
          return;
      }
    } catch {
      this.thumbnail.set({ kind: 'none' });
    }
  }

  /** Show "in progress" and retry a few times while the backend generates the preview. */
  private retryLater(): void {
    if (this.retries >= MAX_RETRIES) {
      this.thumbnail.set({ kind: 'none' });
      return;
    }
    this.retries += 1;
    this.thumbnail.set({ kind: 'pending' });
    setTimeout(() => void this.fetchPreview(), RETRY_MS);
  }
}

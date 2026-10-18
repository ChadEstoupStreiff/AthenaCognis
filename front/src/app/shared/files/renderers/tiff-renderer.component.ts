import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { FilesApi } from '../../../core/files/files.api';

const RGBA_CHANNELS = 4;

/** Decoded TIFF page. */
interface TiffPage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Multi-page TIFF viewer (decoded in the browser with UTIF). */
@Component({
  selector: 'ac-tiff-renderer',
  imports: [ButtonModule],
  template: `
    @if (pages.isLoading()) {
      <div class="ac-muted"><i class="pi pi-spin pi-spinner"></i> Decoding TIFF…</div>
    } @else if (pages.error()) {
      <div class="ac-muted">This TIFF could not be decoded.</div>
    } @else {
      @if ((pages.value()?.length ?? 0) > 1) {
        <div class="pager">
          <p-button
            icon="pi pi-chevron-left"
            [text]="true"
            size="small"
            [disabled]="page() === 0"
            ariaLabel="Previous page"
            (onClick)="page.set(page() - 1)"
          />
          <span>Page {{ page() + 1 }} / {{ pages.value()?.length }}</span>
          <p-button
            icon="pi pi-chevron-right"
            [text]="true"
            size="small"
            [disabled]="page() + 1 >= (pages.value()?.length ?? 0)"
            ariaLabel="Next page"
            (onClick)="page.set(page() + 1)"
          />
        </div>
      }
      <canvas #canvas></canvas>
    }
  `,
  styles: `
    canvas {
      max-width: 100%;
      max-height: 80vh;
      border-radius: 8px;
    }
    .pager {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TiffRendererComponent {
  private readonly files = inject(FilesApi);
  private readonly http = inject(HttpClient);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly page = signal(0);
  protected readonly pages = resource({
    params: () => this.path(),
    loader: ({ params }) => this.decode(params),
  });

  /** Draw the selected page whenever it or the canvas changes. */
  constructor() {
    effect(() => {
      const canvas = this.canvas()?.nativeElement;
      const page = this.pages.value()?.[this.page()];
      if (canvas !== undefined && page !== undefined) {
        canvas.width = page.width;
        canvas.height = page.height;
        canvas
          .getContext('2d')
          ?.putImageData(new ImageData(page.rgba, page.width, page.height), 0, 0);
      }
    });
  }

  /**
   * Download and decode every page.
   *
   * @param path - Shared path.
   * @returns Pages.
   */
  private async decode(path: string): Promise<TiffPage[]> {
    const [utif, buffer] = await Promise.all([
      import('utif2'),
      firstValueFrom(this.http.get(this.files.contentUrl(path), { responseType: 'arraybuffer' })),
    ]);
    const decoder = utif.default;
    return decoder.decode(buffer).map((ifd) => {
      decoder.decodeImage(buffer, ifd);
      const rgba = new Uint8ClampedArray(new ArrayBuffer(ifd.width * ifd.height * RGBA_CHANNELS));
      rgba.set(decoder.toRGBA8(ifd));
      return { width: ifd.width, height: ifd.height, rgba };
    });
  }
}

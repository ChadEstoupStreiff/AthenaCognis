import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { OcrBox } from '@domain/contracts';

const PERCENT = 100;

/** Box in percent of the image size. */
interface OverlayBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

/** Image with an optional OCR boxes overlay (SVG-free, CSS percent boxes). */
@Component({
  selector: 'ac-image-renderer',
  template: `
    <div class="frame">
      <img [src]="src()" [alt]="alt()" (load)="onLoad($event)" />
      @if (showBoxes() && natural() !== null) {
        <div class="overlay" aria-hidden="true">
          @for (box of overlay(); track $index) {
            <div
              class="box"
              [style.left.%]="box.left"
              [style.top.%]="box.top"
              [style.width.%]="box.width"
              [style.height.%]="box.height"
            >
              <span>{{ box.label }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './image-renderer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageRendererComponent {
  /** Image URL. */
  readonly src = input.required<string>();
  /** Alt text. */
  readonly alt = input('');
  /** OCR boxes. */
  readonly boxes = input<readonly OcrBox[]>([]);
  /** Show the boxes. */
  readonly showBoxes = input(false);
  /** Prefix labels with the confidence. */
  readonly showScores = input(false);

  protected readonly natural = signal<{ readonly width: number; readonly height: number } | null>(
    null,
  );

  protected readonly overlay = computed<OverlayBox[]>(() => {
    const size = this.natural();
    if (size === null) {
      return [];
    }
    return this.boxes().map((box) => {
      const scaleX = box.normalized ? PERCENT : PERCENT / size.width;
      const scaleY = box.normalized ? PERCENT : PERCENT / size.height;
      const score =
        this.showScores() && box.score !== null ? `${(box.score * PERCENT).toFixed(0)}% · ` : '';
      return {
        left: box.x1 * scaleX,
        top: box.y1 * scaleY,
        width: (box.x2 - box.x1) * scaleX,
        height: (box.y2 - box.y1) * scaleY,
        label: score + box.text,
      };
    });
  });

  /**
   * Record the natural image size (boxes are in pixels).
   *
   * @param event - Load event.
   */
  protected onLoad(event: Event): void {
    const image = event.target as HTMLImageElement;
    this.natural.set({ width: image.naturalWidth, height: image.naturalHeight });
  }
}

import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { CaptureService } from '../../core/capture/capture.service';

/**
 * Check that a drag carries files (not text or links).
 *
 * @param event - Drag event.
 * @returns `true` for file drags.
 */
function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

/** Full-window drop target: dropping files anywhere opens the upload dialog. */
@Component({
  selector: 'ac-drop-overlay',
  template: `
    @if (active()) {
      <div class="overlay" aria-hidden="true">
        <div class="target">
          <i class="pi pi-cloud-upload"></i>
          <strong>Drop to upload</strong>
        </div>
      </div>
    }
  `,
  styles: `
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--p-primary-color) 18%, rgb(0 0 0 / 0.35));
      backdrop-filter: blur(2px);
      pointer-events: none;
    }
    .target {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 40px 56px;
      border: 2px dashed #fff;
      border-radius: 20px;
      color: #fff;
      font-size: 18px;
    }
    .target i {
      font-size: 3rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropOverlayComponent {
  private readonly capture = inject(CaptureService);
  private depth = 0;

  protected readonly active = signal(false);

  /** Listen to window drag events. */
  constructor() {
    const onEnter = (event: DragEvent): void => {
      if (hasFiles(event) && !this.capture.uploadOpen()) {
        this.depth += 1;
        this.active.set(true);
      }
    };
    const onLeave = (): void => {
      this.depth = Math.max(0, this.depth - 1);
      if (this.depth === 0) {
        this.active.set(false);
      }
    };
    const onOver = (event: DragEvent): void => {
      if (this.active()) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent): void => {
      if (!this.active()) {
        return;
      }
      event.preventDefault();
      this.depth = 0;
      this.active.set(false);
      this.capture.openUpload([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    });
  }
}

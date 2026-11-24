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

/** Attribute marking an element that handles file drops itself (e.g. the notes editor). */
export const OWN_DROP_ATTRIBUTE = 'data-own-drop';

/**
 * Check whether a drag happens over an element that handles file drops itself.
 *
 * @param target - Event target.
 * @returns `true` inside an own drop zone.
 */
export function isOwnDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${OWN_DROP_ATTRIBUTE}]`) !== null;
}

/** Full-window drop target: dropping files anywhere (except own drop zones) opens the upload dialog. */
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
    const listeners: [keyof WindowEventMap, (event: DragEvent) => void][] = [
      [
        'dragenter',
        (event) => {
          this.onEnter(event);
        },
      ],
      [
        'dragleave',
        () => {
          this.onLeave();
        },
      ],
      [
        'dragover',
        (event) => {
          this.onOver(event);
        },
      ],
      [
        'drop',
        (event) => {
          this.onDrop(event);
        },
      ],
    ];
    for (const [type, listener] of listeners) {
      window.addEventListener(type, listener as EventListener);
    }
    inject(DestroyRef).onDestroy(() => {
      for (const [type, listener] of listeners) {
        window.removeEventListener(type, listener as EventListener);
      }
    });
  }

  /**
   * Show the overlay when files start being dragged over the window.
   *
   * @param event - Drag event.
   */
  private onEnter(event: DragEvent): void {
    if (hasFiles(event) && !this.capture.uploadOpen()) {
      this.depth += 1;
      this.active.set(true);
    }
  }

  /** Hide the overlay once the drag left the window. */
  private onLeave(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      this.active.set(false);
    }
  }

  /**
   * Accept the drop, except over elements handling files themselves.
   *
   * @param event - Drag event.
   */
  private onOver(event: DragEvent): void {
    if (this.depth === 0) {
      return;
    }
    const isOwn = isOwnDropZone(event.target);
    this.active.set(!isOwn);
    if (!isOwn) {
      event.preventDefault();
    }
  }

  /**
   * Open the upload dialog with the dropped files (own drop zones keep theirs).
   *
   * @param event - Drag event.
   */
  private onDrop(event: DragEvent): void {
    const wasActive = this.active();
    this.depth = 0;
    this.active.set(false);
    if (!wasActive || isOwnDropZone(event.target)) {
      return;
    }
    event.preventDefault();
    this.capture.openUpload([...(event.dataTransfer?.files ?? [])]);
  }
}

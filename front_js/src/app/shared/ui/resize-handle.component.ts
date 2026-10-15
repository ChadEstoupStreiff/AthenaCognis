import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  model,
  output,
} from '@angular/core';

const KEYBOARD_STEP = 24;
const DEFAULT_MIN_WIDTH = 240;
const DEFAULT_RESERVE = 320;

/**
 * Clamp a panel width between a minimum and a maximum (the minimum wins when they cross).
 *
 * @param width - Requested width.
 * @param min - Smallest width.
 * @param max - Largest width.
 * @returns Rounded allowed width.
 */
export function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, width)));
}

/** Which side of the handle the resized panel sits on. */
export type PanelSide = 'before' | 'after';

/**
 * Vertical drag handle resizing the panel before or after it (pointer or arrow keys).
 * Dragging toward the other side grows the panel; the width is clamped so the other side keeps
 * `reserve` pixels.
 */
@Component({
  selector: 'ac-resize-handle',
  template: `<span class="grip" aria-hidden="true"></span>`,
  host: {
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'vertical',
    '[attr.aria-valuenow]': 'width()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-label]': 'label()',
    '(pointerdown)': 'start($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'stop($event)',
    '(pointercancel)': 'stop($event)',
    '(dblclick)': 'restore.emit()',
    '(keydown.arrowleft)': 'nudge($event, -1)',
    '(keydown.arrowright)': 'nudge($event, 1)',
  },
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      align-self: stretch;
      cursor: col-resize;
      touch-action: none;
      user-select: none;
      border-radius: 6px;
    }
    .grip {
      width: 4px;
      height: 48px;
      border-radius: 999px;
      background: var(--ac-panel-border);
      transition: background 0.15s ease;
    }
    :host(:hover) .grip,
    :host(:focus-visible) .grip,
    :host(.dragging) .grip {
      background: var(--p-primary-color);
    }
    :host(:focus-visible) {
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResizeHandleComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private startX = 0;
  private startWidth = 0;
  private dragging = false;

  /** Width of the resized panel in pixels. */
  readonly width = model.required<number>();
  /** Smallest panel width. */
  readonly min = input(DEFAULT_MIN_WIDTH);
  /** Side of the resized panel. */
  readonly panel = input<PanelSide>('after');
  /** Pixels always left to the other side. */
  readonly reserve = input(DEFAULT_RESERVE);
  /** Accessible name. */
  readonly label = input('Resize panel');
  /** Double-click: restore the default width. */
  readonly restore = output();

  /**
   * Begin a drag.
   *
   * @param event - Pointer event.
   */
  protected start(event: PointerEvent): void {
    this.dragging = true;
    this.startX = event.clientX;
    this.startWidth = this.currentWidth();
    this.host.nativeElement.setPointerCapture(event.pointerId);
    this.host.nativeElement.classList.add('dragging');
  }

  /**
   * Follow the pointer.
   *
   * @param event - Pointer event.
   */
  protected move(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }
    this.width.set(this.clamp(this.startWidth + this.growth(event.clientX - this.startX)));
  }

  /**
   * End a drag.
   *
   * @param event - Pointer event.
   */
  protected stop(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.host.nativeElement.releasePointerCapture(event.pointerId);
    this.host.nativeElement.classList.remove('dragging');
  }

  /**
   * Resize with the keyboard.
   *
   * @param event - Key event.
   * @param direction - Arrow direction: -1 left, 1 right.
   */
  protected nudge(event: Event, direction: 1 | -1): void {
    event.preventDefault();
    this.width.set(this.clamp(this.currentWidth() + this.growth(direction * KEYBOARD_STEP)));
  }

  /**
   * Rendered width of the resized panel (the bound width may be a placeholder).
   *
   * @returns Width in pixels.
   */
  private currentWidth(): number {
    const host = this.host.nativeElement;
    const panel = this.panel() === 'after' ? host.nextElementSibling : host.previousElementSibling;
    return panel?.getBoundingClientRect().width ?? this.width();
  }

  /**
   * Width change caused by a horizontal move.
   *
   * @param deltaX - Move in pixels (positive = right).
   * @returns Width change.
   */
  private growth(deltaX: number): number {
    return this.panel() === 'after' ? -deltaX : deltaX;
  }

  /**
   * Keep a width between the minimum and what the container allows.
   *
   * @param width - Requested width.
   * @returns Allowed width.
   */
  private clamp(width: number): number {
    const container = this.host.nativeElement.parentElement?.clientWidth ?? Infinity;
    return clampPanelWidth(width, this.min(), container - this.reserve());
  }
}

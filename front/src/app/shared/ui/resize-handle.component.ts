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

/** Width limits and snap distance of a collapsible panel. */
export interface SnapBounds {
  /** Smallest expanded width. */
  readonly min: number;
  /** Largest expanded width. */
  readonly max: number;
  /** Drag distance past the minimum (collapse) or the collapse point (expand) that flips the mode. */
  readonly snap: number;
}

/** Panel mode and width after a drag step. */
export interface PanelSnap {
  readonly collapsed: boolean;
  readonly width: number;
}

/**
 * Resolve a drag on a collapsible panel: dragging `snap` px under the minimum collapses it,
 * dragging a collapsed panel `snap` px open expands it back at the minimum width.
 *
 * @param requested - Width the pointer asks for.
 * @param anchor - Width where the current mode began (drag start or last flip).
 * @param collapsed - Whether the panel is collapsed now.
 * @param bounds - Width limits and snap distance.
 * @returns New mode and expanded width.
 */
export function snapPanelWidth(
  requested: number,
  anchor: number,
  collapsed: boolean,
  bounds: SnapBounds,
): PanelSnap {
  if (collapsed) {
    return { collapsed: requested - anchor <= bounds.snap, width: bounds.min };
  }
  if (requested < bounds.min - bounds.snap) {
    return { collapsed: true, width: bounds.min };
  }
  return { collapsed: false, width: clampPanelWidth(requested, bounds.min, bounds.max) };
}

/** Which side of the handle the resized panel sits on. */
export type PanelSide = 'before' | 'after';

/** Separator line: `vertical` resizes widths (panels side by side), `horizontal` resizes heights (stacked). */
export type HandleOrientation = 'vertical' | 'horizontal';

/**
 * Drag handle resizing the panel before or after it (pointer or arrow keys).
 * Dragging toward the other side grows the panel; the size is clamped so the other side keeps
 * `reserve` pixels (unless `fitContainer` is off). With `snap` set, the panel collapses when
 * dragged past its minimum and expands when a collapsed panel is dragged open.
 */
@Component({
  selector: 'ac-resize-handle',
  template: `<span class="grip" aria-hidden="true"></span>`,
  host: {
    role: 'separator',
    tabindex: '0',
    '[attr.aria-orientation]': 'orientation()',
    '[class.horizontal]': "orientation() === 'horizontal'",
    '[attr.aria-valuenow]': 'width()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-label]': 'label()',
    '(pointerdown)': 'start($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'stop($event)',
    '(pointercancel)': 'stop($event)',
    '(dblclick)': 'restore.emit()',
    '(keydown.arrowleft)': "nudgeKey($event, 'vertical', -1)",
    '(keydown.arrowright)': "nudgeKey($event, 'vertical', 1)",
    '(keydown.arrowup)': "nudgeKey($event, 'horizontal', -1)",
    '(keydown.arrowdown)': "nudgeKey($event, 'horizontal', 1)",
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
    :host(.horizontal) {
      width: auto;
      height: 12px;
      align-self: auto;
      cursor: row-resize;
    }
    :host(.horizontal) .grip {
      width: 48px;
      height: 4px;
    }
    :host(:focus-visible) {
      outline: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResizeHandleComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private startPosition = 0;
  private startWidth = 0;
  private dragging = false;

  /** Size of the resized panel in pixels (its height when `orientation` is horizontal). */
  readonly width = model.required<number>();
  /** Separator direction. */
  readonly orientation = input<HandleOrientation>('vertical');
  /** Cap the size so the container keeps `reserve` pixels; off for panels that may grow the page. */
  readonly fitContainer = input(true);
  /** Smallest panel width. */
  readonly min = input(DEFAULT_MIN_WIDTH);
  /** Largest panel width. */
  readonly max = input(Infinity);
  /** Snap distance enabling collapse; `null` = not collapsible. */
  readonly snap = input<number | null>(null);
  /** Whether the panel is collapsed (only changed when `snap` is set). */
  readonly collapsed = model(false);
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
    this.startPosition = this.position(event);
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
    const requested = this.startWidth + this.growth(this.position(event) - this.startPosition);
    const snap = this.snap();
    if (snap === null) {
      this.width.set(this.clamp(requested));
      return;
    }
    const result = snapPanelWidth(requested, this.startWidth, this.collapsed(), this.bounds(snap));
    if (result.collapsed !== this.collapsed()) {
      this.startPosition = this.position(event);
      this.startWidth = result.collapsed ? requested : result.width;
      this.collapsed.set(result.collapsed);
    }
    this.width.set(result.width);
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
   * Resize with the arrow keys of the handle's axis (others are left to the page).
   *
   * @param event - Key event.
   * @param axis - Orientation the arrow belongs to.
   * @param direction - Arrow direction: -1 left/up, 1 right/down.
   */
  protected nudgeKey(event: Event, axis: HandleOrientation, direction: 1 | -1): void {
    if (axis === this.orientation()) {
      this.nudge(event, direction);
    }
  }

  /**
   * Resize with the keyboard.
   *
   * @param event - Key event.
   * @param direction - Arrow direction: -1 left/up, 1 right/down.
   */
  private nudge(event: Event, direction: 1 | -1): void {
    event.preventDefault();
    const growth = this.growth(direction * KEYBOARD_STEP);
    const requested = this.currentWidth() + growth;
    if (this.snap() === null) {
      this.width.set(this.clamp(requested));
      return;
    }
    if (this.collapsed()) {
      this.collapsed.set(growth < 0);
      return;
    }
    this.collapsed.set(requested < this.min());
    this.width.set(this.clamp(requested));
  }

  /**
   * Pointer coordinate along the drag axis.
   *
   * @param event - Pointer event.
   * @returns X for a vertical handle, Y for a horizontal one.
   */
  private position(event: PointerEvent): number {
    return this.orientation() === 'vertical' ? event.clientX : event.clientY;
  }

  /**
   * Rendered size of the resized panel (the bound size may be a placeholder).
   *
   * @returns Width (or height) in pixels.
   */
  private currentWidth(): number {
    const host = this.host.nativeElement;
    const panel = this.panel() === 'after' ? host.nextElementSibling : host.previousElementSibling;
    const rect = panel?.getBoundingClientRect();
    if (rect === undefined) {
      return this.width();
    }
    return this.orientation() === 'vertical' ? rect.width : rect.height;
  }

  /**
   * Size change caused by a move along the drag axis.
   *
   * @param delta - Move in pixels (positive = right/down).
   * @returns Size change.
   */
  private growth(delta: number): number {
    return this.panel() === 'after' ? -delta : delta;
  }

  /**
   * Keep a width between the minimum and what the container allows.
   *
   * @param width - Requested width.
   * @returns Allowed width.
   */
  private clamp(width: number): number {
    return clampPanelWidth(width, this.min(), this.maxWidth());
  }

  /**
   * Largest size allowed by the `max` input and (with `fitContainer`) the container.
   *
   * @returns Width in pixels.
   */
  private maxWidth(): number {
    if (!this.fitContainer()) {
      return this.max();
    }
    const parent = this.host.nativeElement.parentElement;
    const container =
      (this.orientation() === 'vertical' ? parent?.clientWidth : parent?.clientHeight) ?? Infinity;
    return Math.min(this.max(), container - this.reserve());
  }

  /**
   * Snap bounds for the current inputs.
   *
   * @param snap - Snap distance.
   * @returns Width limits and snap distance.
   */
  private bounds(snap: number): SnapBounds {
    return { min: this.min(), max: this.maxWidth(), snap };
  }
}

import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';

const DEFAULT_MIN_HEIGHT = 360;
const SCROLLABLE = /(auto|scroll)/;

/**
 * Nearest scrolling ancestor of an element.
 *
 * @param element - Element.
 * @returns Scroll container (the document element when none).
 */
function scrollParent(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current !== null) {
    if (SCROLLABLE.test(getComputedStyle(current).overflowY)) {
      return current;
    }
    current = current.parentElement;
  }
  return document.documentElement;
}

/**
 * Height left below an element in its scroll container (container scrolled to the top).
 *
 * @param element - Element.
 * @param scroller - Scroll container.
 * @returns Pixels.
 */
function availableHeight(element: HTMLElement, scroller: HTMLElement): number {
  const offset =
    element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const padding = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
  return scroller.clientHeight - offset - padding;
}

/** Size the host to fill the rest of the visible page below it. */
@Directive({
  selector: '[acFillHeight]',
  host: { '[style.height.px]': 'height()' },
})
export class FillHeightDirective {
  /** Lower bound in pixels. */
  readonly acFillHeightMin = input(DEFAULT_MIN_HEIGHT);
  protected readonly height = signal<number | null>(null);

  /** Measure after render and on every layout change. */
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const scroller = scrollParent(element);
      const update = (): void => {
        this.height.set(
          Math.max(this.acFillHeightMin(), Math.floor(availableHeight(element, scroller))),
        );
      };
      const observer = new ResizeObserver(update);
      observer.observe(scroller);
      if (element.parentElement !== null) {
        observer.observe(element.parentElement);
      }
      window.addEventListener('resize', update);
      update();
      destroyRef.onDestroy(() => {
        observer.disconnect();
        window.removeEventListener('resize', update);
      });
    });
  }
}

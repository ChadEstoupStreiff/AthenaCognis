import { afterNextRender, DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

const ROOT_MARGIN = '200px';

/** Emits once when the host scrolls near the viewport (lazy loading). */
@Directive({ selector: '[acInView]' })
export class InViewDirective {
  /** Emitted the first time the element is near the viewport. */
  readonly acInView = output();

  /** Observe the host after the first render. */
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.acInView.emit();
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            this.acInView.emit();
          }
        },
        { rootMargin: ROOT_MARGIN },
      );
      observer.observe(element);
      destroyRef.onDestroy(() => {
        observer.disconnect();
      });
    });
  }
}

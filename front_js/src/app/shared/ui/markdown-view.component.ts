import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { renderInlineMarkdown, renderMarkdown } from '../text/markdown';

/** How the Markdown is laid out. */
export type MarkdownLayout = 'block' | 'compact' | 'inline';

const DEFAULT_LINES = 3;

/** Rendered, sanitized Markdown (full, clamped preview, or inline). */
@Component({
  selector: 'ac-markdown-view',
  template: `@if (layout() === 'inline') {
      <span class="ac-markdown inline" [innerHTML]="html()"></span>
    } @else {
      <div
        #block
        class="ac-markdown"
        [class.compact]="layout() === 'compact'"
        [class.overflowing]="overflowing()"
        [style.--ac-lines]="lines()"
        [innerHTML]="html()"
      ></div>
    }`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    :host:has(.inline) {
      display: inline;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownViewComponent {
  /** Markdown source. */
  readonly source = input<string | null | undefined>('');
  /** Full blocks, a clamped preview, or a single inline run. */
  readonly layout = input<MarkdownLayout>('block');
  /** Visible lines of a compact preview. */
  readonly lines = input(DEFAULT_LINES);

  protected readonly html = computed(() => {
    const source = this.source() ?? '';
    return this.layout() === 'inline' ? renderInlineMarkdown(source) : renderMarkdown(source);
  });
  /** Compact preview cut by its line limit (shows the fade). */
  protected readonly overflowing = signal(false);
  private readonly block = viewChild<ElementRef<HTMLElement>>('block');

  /** Measure the clamped preview after each render. */
  constructor() {
    afterRenderEffect(() => {
      this.html();
      this.lines();
      const element = this.block()?.nativeElement;
      this.overflowing.set(
        element !== undefined && element.scrollHeight > element.clientHeight + 1,
      );
    });
  }
}

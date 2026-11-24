import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ThemeService } from '../../core/theme/theme.service';
import { isInternalLink, renderInlineMarkdown, renderMarkdown } from '../text/markdown';
import { enhanceMarkdown } from '../text/markdown-enhance';

/** How the Markdown is laid out. */
export type MarkdownLayout = 'block' | 'compact' | 'inline';

const DEFAULT_LINES = 3;
const TASK_SELECTOR = 'input[type="checkbox"]';

/** Rendered, sanitized Markdown (full, clamped preview, or inline). */
@Component({
  selector: 'ac-markdown-view',
  host: { '(click)': 'onClick($event)' },
  template: `@if (layout() === 'inline') {
      <span class="ac-markdown inline" [innerHTML]="html()"></span>
    } @else {
      <div
        #block
        class="ac-markdown"
        [class.compact]="layout() === 'compact'"
        [class.interactive]="interactiveTasks()"
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
  /** Task checkboxes can be clicked (emits `taskToggle`). */
  readonly interactiveTasks = input(false);
  /** Index of the task checkbox clicked (document order). */
  readonly taskToggle = output<number>();
  /** Emitted once math and diagrams are drawn (layout settled). */
  readonly rendered = output<HTMLElement>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  /** Already sanitized by DOMPurify (with a style allowlist), so Angular keeps the inline styles. */
  protected readonly html = computed(() => {
    const source = this.source() ?? '';
    const html = this.layout() === 'inline' ? renderInlineMarkdown(source) : renderMarkdown(source);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });
  /** Compact preview cut by its line limit (shows the fade). */
  protected readonly overflowing = signal(false);
  private readonly block = viewChild<ElementRef<HTMLElement>>('block');

  /** Measure the clamped preview and enhance the Markdown after each render. */
  constructor() {
    afterRenderEffect(() => {
      this.html();
      this.lines();
      const element = this.block()?.nativeElement;
      this.overflowing.set(
        element !== undefined && element.scrollHeight > element.clientHeight + 1,
      );
    });
    afterRenderEffect(() => {
      this.html();
      const element = this.block()?.nativeElement;
      if (element !== undefined) {
        void this.enhance(element, this.interactiveTasks(), this.theme.dark());
      }
    });
  }

  /**
   * Route in-app links and report task checkbox clicks.
   *
   * @param event - Click event.
   */
  protected onClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches(TASK_SELECTOR)) {
      this.toggleTask(event, target);
      return;
    }
    const anchor = target instanceof Element ? target.closest('a') : null;
    const href = anchor?.getAttribute('href') ?? '';
    if (anchor !== null && isInternalLink(href) && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }

  /**
   * Emit the index of a clicked task checkbox (the source update re-renders it).
   *
   * @param event - Click event.
   * @param checkbox - Checkbox.
   */
  private toggleTask(event: MouseEvent, checkbox: HTMLInputElement): void {
    const root = this.block()?.nativeElement;
    if (!this.interactiveTasks() || root === undefined) {
      return;
    }
    event.preventDefault();
    this.taskToggle.emit([...root.querySelectorAll(TASK_SELECTOR)].indexOf(checkbox));
  }

  /**
   * Enable task checkboxes, typeset math and draw diagrams.
   *
   * @param root - Rendered root.
   * @param interactive - Task checkboxes clickable.
   * @param dark - Dark theme.
   */
  private async enhance(root: HTMLElement, interactive: boolean, dark: boolean): Promise<void> {
    if (interactive) {
      for (const checkbox of root.querySelectorAll<HTMLInputElement>(TASK_SELECTOR)) {
        checkbox.disabled = false;
      }
    }
    await enhanceMarkdown(root, dark);
    this.rendered.emit(root);
  }
}

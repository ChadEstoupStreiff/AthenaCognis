import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { highlightCode } from '../text/highlight';

/** Syntax-highlighted code with line numbers. */
@Component({
  selector: 'ac-code-view',
  template: `<pre class="code hljs"><code [innerHTML]="html()"></code></pre>`,
  styles: `
    .code {
      margin: 0;
      padding: 12px 16px;
      overflow: auto;
      max-height: var(--code-max-height, 75vh);
      border-radius: 10px;
      background: var(--ac-code-background);
      font:
        12.5px/1.55 ui-monospace,
        'SF Mono',
        Menlo,
        Consolas,
        monospace;
      white-space: pre;
      tab-size: 4;
    }
    :host([wrap]) .code {
      white-space: pre-wrap;
      word-break: break-word;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeViewComponent {
  /** Source text. */
  readonly code = input('');
  /** highlight.js language id. */
  readonly language = input('plaintext');

  protected readonly html = computed(() => highlightCode(this.code(), this.language()));
}

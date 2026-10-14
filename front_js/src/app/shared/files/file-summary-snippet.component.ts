import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { SummaryRecord } from '@domain/contracts';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { InViewDirective } from '../directives/in-view.directive';
import { MarkdownViewComponent } from '../ui/markdown-view.component';

/** First lines of a file's AI summary, loaded when visible. */
@Component({
  selector: 'ac-file-summary-snippet',
  imports: [InViewDirective, MarkdownViewComponent],
  template: `
    <div class="snippet" (acInView)="load()">
      @if (summary(); as record) {
        @if (record.keywords.length > 0) {
          <div class="keywords">{{ record.keywords.slice(0, 6).join(' · ') }}</div>
        }
        <ac-markdown-view [source]="record.summary" layout="compact" />
      }
    </div>
  `,
  styles: `
    .snippet {
      min-height: 1px;
      font-size: 12.5px;
      color: var(--ac-muted);
    }
    .keywords {
      font-weight: 600;
      color: var(--p-primary-color);
      margin-bottom: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileSummarySnippetComponent {
  private readonly details = inject(FileDetailsApi);
  private started = false;

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly summary = signal<SummaryRecord | null>(null);

  /** Load the summary once visible. */
  protected async load(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.summary.set(await this.details.summary(this.path()));
  }
}

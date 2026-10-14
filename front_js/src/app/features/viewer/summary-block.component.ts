import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';

const CHARS_PER_LINE = 70;

/** AI summary of a file: keywords, rendered text, summarize / refresh. */
@Component({
  selector: 'ac-summary-block',
  imports: [ButtonModule, TagModule, MarkdownViewComponent],
  template: `
    <section class="block">
      <h3>Summary</h3>
      @if (summary.value(); as record) {
        @if (record.keywords.length > 0) {
          <div class="row-actions">
            @for (keyword of record.keywords; track keyword) {
              <p-tag [value]="keyword" severity="secondary" />
            }
          </div>
        }
        <div
          class="summary-text"
          [class.clamped]="clamped()"
          [style.--ac-clamp-lines]="collapsedLines()"
        >
          <ac-markdown-view [source]="record.summary" />
        </div>
        @if (collapsible()) {
          <button type="button" class="more" (click)="expanded.set(!expanded())">
            {{ expanded() ? 'Show less' : 'Show more' }}
          </button>
        }
      } @else if (!summary.isLoading()) {
        <p class="empty">No summary yet.</p>
      }
      <div class="row-actions">
        <p-button
          [label]="summary.value() ? 'Regenerate summary' : 'Summarize'"
          icon="pi pi-sparkles"
          size="small"
          [outlined]="true"
          (onClick)="summarize()"
        />
        <p-button
          icon="pi pi-refresh"
          size="small"
          [text]="true"
          ariaLabel="Refresh"
          (onClick)="refresh()"
        />
      </div>
    </section>
  `,
  styleUrl: './inspector.scss',
  styles: `
    .summary-text.clamped {
      max-height: calc(var(--ac-clamp-lines) * 1.65em);
      overflow: hidden;
      mask-image: linear-gradient(to bottom, black 65%, transparent);
    }
    .more {
      align-self: flex-start;
      margin-top: -6px;
      padding: 0;
      border: none;
      background: none;
      color: var(--p-primary-color);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryBlockComponent {
  private readonly details = inject(FileDetailsApi);
  private readonly jobs = inject(JobsStore);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);

  /** Shared path. */
  readonly path = input.required<string>();
  /** Lines shown before "Show more" (0 = always full). */
  readonly collapsedLines = input(0);

  protected readonly expanded = linkedSignal({ source: this.path, computation: () => false });

  protected readonly summary = resource({
    params: () => ({ path: this.path(), version: this.sync.version('jobs')() }),
    loader: ({ params }) => this.details.summary(params.path),
  });

  protected readonly collapsible = computed(
    () =>
      this.collapsedLines() > 0 &&
      (this.summary.value()?.summary.length ?? 0) > this.collapsedLines() * CHARS_PER_LINE,
  );
  protected readonly clamped = computed(() => this.collapsible() && !this.expanded());

  /** Queue a summary (waits for OCR/transcription when needed). */
  protected summarize(): void {
    this.jobs.runPipeline({ paths: [this.path()], operations: ['summary'] });
    this.notify.info('Summary requested', 'It appears here when the job completes.');
  }

  /** Refresh AI results. */
  protected refresh(): void {
    this.sync.invalidate('jobs');
  }
}

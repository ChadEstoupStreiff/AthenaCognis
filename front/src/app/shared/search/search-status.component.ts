import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProgressBarModule } from 'primeng/progressbar';
import type { FileSearch } from '../../core/search/file-search';

const PERCENT = 100;
const MS_PER_SECOND = 1_000;
const SECONDS_DECIMALS = 2;

/** Progress bar and result caption of a streaming search. */
@Component({
  selector: 'ac-search-status',
  imports: [ProgressBarModule],
  template: `
    @if (search().running()) {
      <div class="status">
        <p-progressbar
          [value]="percent()"
          [showValue]="false"
          [mode]="percent() === null ? 'indeterminate' : 'determinate'"
        />
        <span class="ac-muted caption">{{ progressLabel() }}</span>
      </div>
    } @else if (search().error(); as message) {
      <div class="error">{{ message }}</div>
    } @else if (search().elapsedMs() !== null) {
      <span class="ac-muted caption"
        >{{ search().results().length }} file(s) in {{ seconds() }} s</span
      >
    }
  `,
  styles: `
    .status {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    p-progressbar {
      height: 4px;
    }
    .caption {
      font-size: 12px;
    }
    .error {
      color: var(--p-red-500);
      font-size: 13px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchStatusComponent {
  /** Search store. */
  readonly search = input.required<FileSearch>();

  protected readonly percent = computed(() => {
    const progress = this.search().progress();
    return progress === null || progress.total === 0
      ? null
      : Math.round((progress.current / progress.total) * PERCENT);
  });

  protected readonly progressLabel = computed(() => {
    const progress = this.search().progress();
    const found = this.search().results().length;
    if (progress === null || progress.total === 0) {
      return `Searching… ${String(found)} found`;
    }
    const scope = progress.semantic
      ? 'Semantic search'
      : `Scanning ${String(progress.current)} / ${String(progress.total)}`;
    return `${scope} · ${String(found)} found${progress.file === '' ? '' : ` · ${progress.file}`}`;
  });

  protected readonly seconds = computed(() =>
    ((this.search().elapsedMs() ?? 0) / MS_PER_SECOND).toFixed(SECONDS_DECIMALS),
  );
}

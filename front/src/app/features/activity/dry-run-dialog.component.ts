import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  resource,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { GenerationRequest, PromptPartKind } from '@domain/contracts';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { ActivityGenerationApi } from '../../core/activity/activity-generation.api';
import { toApiProblem } from '../../core/api/api-error';
import { partRows, promptStatItems } from './dry-run-stats';

const KIND_ICONS: Readonly<Record<PromptPartKind, string>> = {
  instructions: 'pi pi-align-left',
  source: 'pi pi-database',
  summary: 'pi pi-bolt',
  catalog: 'pi pi-tags',
};

/** Popup building the single prompt of a generation and showing it with its size per block. */
@Component({
  selector: 'ac-dry-run-dialog',
  imports: [DecimalPipe, DialogModule, ProgressBarModule],
  template: `
    <p-dialog
      header="Dry run"
      [modal]="true"
      [visible]="request() !== null"
      (visibleChange)="$event || request.set(null)"
      [dismissableMask]="true"
      appendTo="body"
      [style]="{ width: 'min(960px, 96vw)' }"
    >
      @if (dryRun.isLoading()) {
        <div class="loading">
          <p class="ac-muted">Generating prompt…</p>
          <p-progressbar mode="indeterminate" [style]="{ height: '4px' }" />
        </div>
      } @else if (dryRun.error(); as error) {
        <p class="ac-muted">Dry run failed: {{ errorMessage(error) }}</p>
      } @else if (dryRun.value(); as result) {
        <div class="result">
          <div class="meta">
            <span class="ac-muted">Model</span>
            <strong>{{ result.model || 'Not set' }}</strong>
          </div>
          <dl class="stats">
            @for (item of totals(); track item.label) {
              <div [class.warning]="item.isWarning">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            }
          </dl>
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Activities</th>
                  <th>Characters</th>
                  <th>Words</th>
                  <th>Lines</th>
                  <th>Tokens</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.label) {
                  <tr [class.failed]="row.error !== ''" [title]="row.error">
                    <td>
                      <i [class]="kindIcons[row.kind]" aria-hidden="true"></i>
                      {{ row.label }}
                      @if (row.error) {
                        <i class="pi pi-exclamation-triangle" aria-label="Unreadable"></i>
                      }
                    </td>
                    <td>{{ row.activities ?? '—' }}</td>
                    <td>{{ row.characters }}</td>
                    <td>{{ row.words }}</td>
                    <td>{{ row.lines }}</td>
                    <td>{{ row.tokens }}</td>
                    <td class="share">
                      <span class="bar" [style.width.%]="row.share"></span>
                      {{ row.share | number: '1.0-1' }}%
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <pre>{{ result.prompt }}</pre>
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .loading {
      display: grid;
      gap: 8px;
      padding: 16px 0;
    }
    .result {
      display: grid;
      gap: 16px;
    }
    .meta {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
    }
    .stats div {
      padding: 4px 10px;
      border: 1px solid var(--p-content-border-color);
      border-radius: 6px;
    }
    .stats div.warning {
      border-color: var(--p-orange-500);
      color: var(--p-orange-500);
    }
    dt {
      font-size: calc(11px * var(--ac-font-scale));
      opacity: 0.7;
    }
    dd {
      margin: 0;
      font-weight: 600;
    }
    .table {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: calc(13px * var(--ac-font-scale));
    }
    th,
    td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--p-content-border-color);
      text-align: right;
      white-space: nowrap;
    }
    th:first-child,
    td:first-child {
      text-align: left;
    }
    th {
      font-weight: 600;
      opacity: 0.7;
    }
    td i {
      margin-right: 4px;
      opacity: 0.7;
    }
    tr.failed td:first-child {
      color: var(--p-red-500);
    }
    .share {
      position: relative;
      min-width: 90px;
    }
    .bar {
      position: absolute;
      inset: 4px auto 4px 0;
      border-radius: 3px;
      background: var(--p-primary-color);
      opacity: 0.18;
    }
    pre {
      max-height: 50vh;
      overflow: auto;
      margin: 0;
      padding: 12px;
      border-radius: 6px;
      background: var(--p-content-hover-background);
      font-size: calc(12px * var(--ac-font-scale));
      white-space: pre-wrap;
      word-break: break-word;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DryRunDialogComponent {
  private readonly api = inject(ActivityGenerationApi);

  /** Request to dry run; the popup shows while set, closing clears it. */
  readonly request = model<GenerationRequest | null>(null);

  protected readonly kindIcons = KIND_ICONS;
  protected readonly dryRun = resource({
    params: () => this.request() ?? undefined,
    loader: ({ params }) => this.api.dryRun(params),
  });
  /** Figures of the whole prompt. */
  protected readonly totals = computed(() => {
    const result = this.dryRun.hasValue() ? this.dryRun.value() : null;
    return result === null ? [] : promptStatItems(result.stats, result.context_tokens);
  });
  /** Size of each block of the prompt. */
  protected readonly rows = computed(() => {
    const result = this.dryRun.hasValue() ? this.dryRun.value() : null;
    return result === null ? [] : partRows(result.parts, result.stats.estimated_tokens);
  });

  /**
   * Readable reason of a failure.
   *
   * @param error - Thrown value.
   * @returns Message.
   */
  protected errorMessage(error: unknown): string {
    return toApiProblem(error).message;
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { NoteHistoryApi, type NoteSnapshot } from '../../core/files/note-history.api';
import { diffLines } from '../../shared/text/text-diff';

/** Versions of a note with a diff against the current text and restore. */
@Component({
  selector: 'ac-note-history-dialog',
  imports: [DatePipe, ButtonModule, DialogModule],
  template: `
    <p-dialog
      header="Version history"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(1100px, 96vw)' }"
      [maximizable]="true"
    >
      <div class="history">
        <nav class="versions" aria-label="Versions">
          @for (snapshot of snapshots.value() ?? []; track snapshot.id) {
            <button
              type="button"
              class="version"
              [class.active]="snapshot.id === selected()?.id"
              (click)="selected.set(snapshot)"
            >
              <span>{{ snapshot.createdAt | date: 'medium' }}</span>
              <small class="ac-muted">{{ snapshot.size }} bytes</small>
            </button>
          } @empty {
            <p class="ac-muted">
              @if (snapshots.isLoading()) {
                Loading…
              } @else {
                No saved version yet. Versions are kept while you edit (at most every 5 minutes).
              }
            </p>
          }
        </nav>
        <section class="diff" aria-label="Changes since this version">
          @if (selected()) {
            <p class="legend ac-muted">
              <span class="removed">− only in this version</span>
              <span class="added">+ only in the current post-it</span>
            </p>
            <pre>@for (line of diff(); track $index) {<span [class]="line.kind">{{ line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  ' }}{{ line.text }}
</span>}</pre>
          } @else {
            <p class="ac-muted">Pick a version to compare it with the current post-it.</p>
          }
        </section>
      </div>
      <ng-template #footer>
        <p-button label="Close" severity="secondary" [text]="true" (onClick)="visible.set(false)" />
        <p-button
          label="Restore this version"
          icon="pi pi-history"
          [disabled]="selectedContent.value() === undefined"
          (onClick)="restoreSelected()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .history {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      gap: 12px;
      height: min(65vh, 640px);
    }
    .versions {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow-y: auto;
    }
    .version {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 6px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .version:hover {
      background: var(--p-content-hover-background);
    }
    .version.active {
      background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
    }
    .diff {
      min-height: 0;
      overflow: auto;
    }
    .legend {
      display: flex;
      gap: 16px;
      margin: 0 0 8px;
      font-size: calc(12px * var(--ac-font-scale));
    }
    pre {
      margin: 0;
      font:
        12px/1.5 ui-monospace,
        'SF Mono',
        Menlo,
        Consolas,
        monospace;
      white-space: pre-wrap;
    }
    .added {
      display: block;
      background: color-mix(in srgb, #16a34a 16%, transparent);
    }
    .removed {
      display: block;
      background: color-mix(in srgb, #dc2626 16%, transparent);
    }
    .legend .added,
    .legend .removed {
      display: inline;
      padding: 0 4px;
      border-radius: 4px;
    }
    @media (max-width: 720px) {
      .history {
        grid-template-columns: 1fr;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteHistoryDialogComponent {
  private readonly history = inject(NoteHistoryApi);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Note path. */
  readonly path = input.required<string>();
  /** Current note text. */
  readonly current = input.required<string>();
  /** Emits the content of the version to restore. */
  readonly restore = output<string>();

  protected readonly selected = signal<NoteSnapshot | null>(null);
  protected readonly snapshots = resource({
    params: () => (this.visible() ? this.path() : undefined),
    loader: ({ params }) => this.history.list(params),
  });
  protected readonly selectedContent = resource({
    params: () => {
      const snapshot = this.selected();
      return snapshot === null ? undefined : { path: this.path(), id: snapshot.id };
    },
    loader: ({ params }) => this.history.read(params.path, params.id),
  });
  protected readonly diff = computed(() => {
    const content = this.selectedContent.value();
    return content === undefined ? [] : diffLines(content, this.current());
  });

  /** Select the newest version when the list arrives, reset on close. */
  constructor() {
    effect(() => {
      const list = this.snapshots.value();
      untracked(() => {
        this.selected.set(list?.[0] ?? null);
      });
    });
  }

  /** Restore the selected version. */
  protected restoreSelected(): void {
    const content = this.selectedContent.value();
    if (content !== undefined) {
      this.restore.emit(content);
      this.visible.set(false);
    }
  }
}

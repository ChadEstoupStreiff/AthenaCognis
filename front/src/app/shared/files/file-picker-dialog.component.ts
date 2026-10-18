import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { FileSearch } from '../../core/search/file-search';
import { SettingsStore } from '../../core/settings/settings.store';
import { EMPTY_SEARCH_FORM, type SearchFormState, toSearchQuery } from '../search/search-form';
import { SearchPanelComponent } from '../search/search-panel.component';
import { SearchStatusComponent } from '../search/search-status.component';
import { FileCollectionComponent } from './file-collection.component';

/** Search and pick files (links, chat attachments, tasks, contacts). */
@Component({
  selector: 'ac-file-picker-dialog',
  imports: [
    ButtonModule,
    DialogModule,
    SearchPanelComponent,
    SearchStatusComponent,
    FileCollectionComponent,
  ],
  providers: [FileSearch],
  template: `
    <p-dialog
      [header]="title()"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(1100px, 98vw)' }"
      [maximizable]="true"
    >
      <div class="picker">
        <aside>
          <ac-search-panel [value]="form()" (valueChange)="form.set($event)" (submitted)="run()" />
        </aside>
        <section>
          <ac-search-status [search]="search" />
          <ac-file-collection
            [paths]="search.results()"
            mode="list"
            clickAction="select"
            [(selection)]="selection"
            [emptyTitle]="search.running() ? 'Searching…' : 'No files'"
          />
        </section>
      </div>
      <ng-template #footer>
        <span class="ac-muted count">{{ selection().length }} selected</span>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          [label]="confirmLabel()"
          icon="pi pi-check"
          [disabled]="selection().length === 0"
          (onClick)="confirm()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .picker {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 16px;
      min-height: 60vh;
    }
    aside {
      max-height: 65vh;
      overflow: auto;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 65vh;
      overflow: auto;
    }
    .count {
      margin-right: auto;
    }
    @media (max-width: 760px) {
      .picker {
        grid-template-columns: 1fr;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilePickerDialogComponent {
  protected readonly search = inject(FileSearch);
  private readonly settings = inject(SettingsStore);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Dialog title. */
  readonly title = input('Choose files');
  /** Confirm button label. */
  readonly confirmLabel = input('Add');
  /** Paths hidden from the results (e.g. the current file). */
  readonly exclude = input<readonly string[]>([]);
  /** Emits the chosen paths. */
  readonly picked = output<readonly string[]>();

  protected readonly form = signal<SearchFormState>({
    ...EMPTY_SEARCH_FORM,
    range: 'all',
    mode: 0,
  });
  protected readonly selection = signal<readonly string[]>([]);

  /** Search when opened and when filters change. */
  constructor() {
    effect(() => {
      this.form();
      if (this.visible()) {
        untracked(() => void this.run());
      }
    });
  }

  /** Run the search. */
  protected async run(): Promise<void> {
    const query = toSearchQuery(this.form(), {
      today: new Date(),
      defaultDays: this.settings.get('search_default_timeframe_days'),
      threshold: this.settings.get('semantic_similarity_threshold'),
    });
    await this.search.run(query);
  }

  /** Emit the selection and close. */
  protected confirm(): void {
    const excluded = new Set(this.exclude());
    this.picked.emit(this.selection().filter((path) => !excluded.has(path)));
    this.selection.set([]);
    this.visible.set(false);
  }
}

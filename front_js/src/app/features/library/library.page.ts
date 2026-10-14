import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectButtonModule } from 'primeng/selectbutton';
import { type RepresentationMode, representationModeOf } from '@domain/contracts';
import { FileSearch } from '../../core/search/file-search';
import { SettingsStore } from '../../core/settings/settings.store';
import { FileBulkBarComponent } from '../../shared/files/file-bulk-bar.component';
import { FileCollectionComponent } from '../../shared/files/file-collection.component';
import {
  formFromParams,
  paramsFromForm,
  type SearchFormState,
  toSearchQuery,
} from '../../shared/search/search-form';
import { SearchPanelComponent } from '../../shared/search/search-panel.component';
import { SearchStatusComponent } from '../../shared/search/search-status.component';

const TEXT_DEBOUNCE_MS = 600;
const FILTERS_OPEN_KEY = 'ac.library.filtersOpen';
const WIDE_SCREEN = '(min-width: 961px)';
const VIEW_OPTIONS = [
  { value: 'cards', icon: 'pi pi-th-large', label: 'Cards' },
  { value: 'list', icon: 'pi pi-list', label: 'List' },
  { value: 'table', icon: 'pi pi-table', label: 'Table' },
];

/**
 * Filters visibility: last choice in this browser, else open on wide screens.
 *
 * @returns Visible.
 */
function initialFiltersOpen(): boolean {
  try {
    const stored = localStorage.getItem(FILTERS_OPEN_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // Storage unavailable: fall back to the screen width.
  }
  return window.matchMedia(WIDE_SCREEN).matches;
}

/** Library: search every file with filters, browse results, act on a selection. */
@Component({
  selector: 'ac-library-page',
  imports: [
    FormsModule,
    SelectButtonModule,
    SearchPanelComponent,
    SearchStatusComponent,
    FileCollectionComponent,
    FileBulkBarComponent,
  ],
  providers: [FileSearch],
  templateUrl: './library.page.html',
  styleUrl: './library.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPage {
  protected readonly search = inject(FileSearch);
  private readonly settings = inject(SettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: this.route.snapshot.queryParams,
  });
  private textTimer: ReturnType<typeof setTimeout> | null = null;
  private lastText: string | null = null;

  protected readonly form = linkedSignal<SearchFormState>(() => formFromParams(this.queryParams()));
  protected readonly view = linkedSignal<RepresentationMode>(() =>
    representationModeOf(this.settings.get('explorer_default_representation_mode')),
  );
  protected readonly viewOptions = VIEW_OPTIONS;
  protected readonly selection = signal<readonly string[]>([]);
  protected readonly filtersOpen = signal(initialFiltersOpen());
  private readonly settingsReady = computed(() => !this.settings.snapshot.isLoading());
  private readonly filtersKey = computed(() => JSON.stringify({ ...this.form(), text: '' }));

  /** Wire URL sync and automatic searches. */
  constructor() {
    effect(() => {
      this.filtersKey();
      if (this.settingsReady()) {
        untracked(() => {
          void this.runNow();
        });
      }
    });
    effect(() => {
      const text = this.form().text;
      untracked(() => {
        this.scheduleTextSearch(text);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.search.cancel();
    });
  }

  /**
   * Update the form and the URL.
   *
   * @param state - New form state.
   */
  protected updateForm(state: SearchFormState): void {
    this.form.set(state);
    void this.router.navigate([], {
      queryParams: paramsFromForm(state),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Show or hide the filters (remembered in this browser).
   *
   * @param open - Visible.
   */
  protected setFiltersOpen(open: boolean): void {
    this.filtersOpen.set(open);
    try {
      localStorage.setItem(FILTERS_OPEN_KEY, String(open));
    } catch {
      // Storage unavailable (private mode): the choice lasts for this page only.
    }
  }

  /** Run the search now (Enter, or filter change). */
  protected async runNow(): Promise<void> {
    this.clearTextTimer();
    const state = this.form();
    this.lastText = state.text;
    this.selection.set([]);
    await this.search.run(
      toSearchQuery(state, {
        today: new Date(),
        defaultDays: this.settings.get('search_default_timeframe_days'),
        threshold: this.settings.get('semantic_similarity_threshold'),
      }),
    );
  }

  /**
   * Debounce searches while typing.
   *
   * @param text - Current text.
   */
  private scheduleTextSearch(text: string): void {
    if (this.lastText === null || text === this.lastText) {
      return;
    }
    this.clearTextTimer();
    this.textTimer = setTimeout(() => void this.runNow(), TEXT_DEBOUNCE_MS);
  }

  /** Cancel the pending text search. */
  private clearTextTimer(): void {
    if (this.textTimer !== null) {
      clearTimeout(this.textTimer);
      this.textTimer = null;
    }
  }
}

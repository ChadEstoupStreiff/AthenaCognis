import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import {
  activeFilterCount,
  DISCOVER_PERIODS,
  DISCOVER_SCOPES,
  type DiscoverRequest,
  NO_RESULT_FILTERS,
  type Paper,
  SEARCH_SORTS,
  SEARCH_SOURCES,
  type SearchHit,
  type SearchSource,
  shortAuthors,
  SOURCE_LABELS,
} from '@domain/sota';
import { formatLocalDate } from '@domain/time';
import { BrainIconComponent } from '../../shared/ui/brain-icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { type SearchMode, SearchStore } from './search.store';

const MIN_YEAR = 1900;

/** Search tab: find papers on OpenAlex, arXiv and CrossRef and import them in one click. */
@Component({
  selector: 'ac-research-search',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    TextareaModule,
    ToggleSwitchModule,
    TooltipModule,
    BrainIconComponent,
    EmptyStateComponent,
  ],
  templateUrl: './search.panel.html',
  styleUrl: './search.panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPanelComponent {
  protected readonly store = inject(SearchStore);

  /** Open a paper already in the library. */
  readonly open = output<Paper>();

  protected readonly sourceOptions = SEARCH_SOURCES.map((value) => ({
    label: SOURCE_LABELS[value],
    value,
  }));
  protected readonly sorts = [...SEARCH_SORTS];
  protected readonly scopes = [...DISCOVER_SCOPES];
  protected readonly periods = [...DISCOVER_PERIODS];
  protected readonly modes: { label: string; value: SearchMode }[] = [
    { label: 'Search', value: 'search' },
    { label: 'Discover related', value: 'discover' },
  ];
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly minYear = MIN_YEAR;
  protected readonly maxYear = new Date().getFullYear();
  protected readonly today = formatLocalDate(new Date());
  /** Result filters panel open. */
  protected readonly showFilters = signal(false);
  protected readonly filterCount = computed(() => activeFilterCount(this.store.resultFilters()));
  protected readonly hiddenCount = computed(
    () => this.store.loaded().length - this.store.results().length,
  );
  /** Keys of hits whose abstract is expanded. */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  /**
   * `authors · year · venue` line of a hit.
   *
   * @param hit - Hit.
   * @returns Line.
   */
  protected details(hit: SearchHit): string {
    return [shortAuthors(hit.info.authors), hit.info.year, hit.info.journal]
      .filter((part) => part.trim() !== '')
      .join(' · ');
  }

  /**
   * Show or hide the full abstract of a hit.
   *
   * @param key - Hit key.
   */
  protected toggleAbstract(key: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  /**
   * Change the searched sources.
   *
   * @param sources - Sources.
   */
  protected setSources(sources: readonly SearchSource[]): void {
    this.store.setFilters({ sources });
  }

  /**
   * Change the discovery settings.
   *
   * @param patch - Changed settings.
   */
  protected setDiscover(patch: Partial<DiscoverRequest>): void {
    this.store.discoverRequest.update((current) => ({ ...current, ...patch }));
  }

  /**
   * Whether a discovery of a kind is running.
   *
   * @param ai - AI search (true) or OpenAlex search (false).
   * @returns Running.
   */
  protected discoverLoading(ai: boolean): boolean {
    const origin = this.store.origin();
    return this.store.loading() && origin?.kind === 'discover' && origin.ai === ai;
  }

  /** Clear every result filter. */
  protected resetFilters(): void {
    this.store.resultFilters.set(NO_RESULT_FILTERS);
  }

  /**
   * Import a PDF the user downloaded for a hit.
   *
   * @param hit - Hit.
   * @param event - Change event of the file input.
   */
  protected attach(hit: SearchHit, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) {
      this.store.importHit(hit, file);
    }
  }
}

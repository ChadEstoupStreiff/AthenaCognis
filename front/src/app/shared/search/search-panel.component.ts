import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { FILE_TYPE_CATEGORIES } from '@domain/files';
import { SEARCH_ENGINES, SEARCH_MODES } from '@domain/search';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { TagChipComponent } from '../ui/tag-chip.component';
import {
  EMPTY_SEARCH_FORM,
  RANGE_LABELS,
  type RangePreset,
  type SearchFormState,
} from './search-form';

/** Boolean fields of the form. */
type FlagKey = 'excludeCategories' | 'excludeProjects' | 'excludeTags' | 'exact';

/** List fields of the form. */
type ListKey = 'categories' | 'projects' | 'tags';

/** Sidebar column, or a full-width bar with collapsible filters. */
export type SearchPanelLayout = 'stack' | 'wide';

/**
 * Number of active filters (each picked value counts, plus a non-default date range).
 *
 * @param state - Form state.
 * @returns Active filter count.
 */
export function activeFilterCount(state: SearchFormState): number {
  const lists = [state.categories, state.projects, state.tags];
  const picked = lists.reduce((sum, list) => sum + list.length, 0);
  return picked + (state.range === 'default' ? 0 : 1);
}

/** File search filters (text, mode, dates, types, projects, tags). */
@Component({
  selector: 'ac-search-panel',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MultiSelectModule,
    SelectButtonModule,
    TooltipModule,
    TagChipComponent,
  ],
  templateUrl: './search-panel.component.html',
  styleUrl: './search-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPanelComponent {
  protected readonly catalog = inject(CatalogStore);

  /** Form state (two-way). */
  readonly value = model<SearchFormState>(EMPTY_SEARCH_FORM);
  /** Hide the tag filter (the page forces tags). */
  readonly hideTags = input(false);
  /** Sidebar column or full-width bar. */
  readonly layout = input<SearchPanelLayout>('stack');
  /** Filters shown in the wide layout (two-way). */
  readonly filtersOpen = model(true);
  /** Emitted when the user presses Enter in the search box. */
  readonly submitted = output();

  protected readonly categories = FILE_TYPE_CATEGORIES;
  protected readonly modes = [...SEARCH_MODES];
  protected readonly engines = [...SEARCH_ENGINES];
  protected readonly ranges = RANGE_LABELS;
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly tagOptions = computed(() => this.catalog.tagList().map((tag) => tag.name));
  protected readonly activeFilters = computed(() => activeFilterCount(this.value()));
  protected readonly customRange = computed(() => {
    const state = this.value();
    return [parseLocalDate(state.from), parseLocalDate(state.to)].filter(
      (date): date is Date => date !== null,
    );
  });

  /**
   * Patch the form.
   *
   * @param patch - Changed fields.
   */
  protected patch(patch: Partial<SearchFormState>): void {
    this.value.update((state) => ({ ...state, ...patch }));
  }

  /**
   * Toggle a value in a list field.
   *
   * @param key - List field.
   * @param item - Value.
   */
  protected toggleItem(key: ListKey, item: string): void {
    const list = this.value()[key];
    this.patch({
      [key]: list.includes(item) ? list.filter((value) => value !== item) : [...list, item],
    });
  }

  /**
   * Set a boolean field.
   *
   * @param key - Flag field.
   * @param flag - New value.
   */
  protected setFlag(key: FlagKey, flag: boolean): void {
    this.patch({ [key]: flag });
  }

  /**
   * Pick a range preset (clicking the active one returns to the default range).
   *
   * @param range - Preset.
   */
  protected setRange(range: RangePreset): void {
    this.patch({ range: this.value().range === range ? 'default' : range });
  }

  /**
   * Apply a custom date range from the date picker.
   *
   * @param dates - Selected dates.
   */
  protected setCustomRange(dates: (Date | null)[] | null): void {
    const [from, to] = dates ?? [];
    this.patch({
      range: 'custom',
      from: from instanceof Date ? formatLocalDate(from) : '',
      to: to instanceof Date ? formatLocalDate(to) : '',
    });
  }

  /** Reset every filter (keeps the text). */
  protected reset(): void {
    this.value.set({ ...EMPTY_SEARCH_FORM, text: this.value().text });
  }
}

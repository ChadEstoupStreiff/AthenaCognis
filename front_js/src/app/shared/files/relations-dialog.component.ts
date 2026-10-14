import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import type { NameDiff, RelationsByPath } from '@domain/contracts';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { TagChipComponent } from '../ui/tag-chip.component';

/** Whether a name is on all, some or none of the selected files. */
type Coverage = 'all' | 'some' | 'none';

/** One checkbox row. */
interface CoverageRow {
  readonly name: string;
  readonly initial: Coverage;
}

/**
 * Coverage of each name across files.
 *
 * @param names - Candidate names.
 * @param lists - Names linked to each file.
 * @returns Coverage per name.
 */
export function coverageOf(
  names: readonly string[],
  lists: readonly (readonly string[])[],
): CoverageRow[] {
  return names.map((name) => {
    const count = lists.filter((list) => list.includes(name)).length;
    const initial: Coverage = count === 0 ? 'none' : count === lists.length ? 'all' : 'some';
    return { name, initial };
  });
}

/**
 * Compute the diff between initial and chosen coverage.
 *
 * @param rows - Rows with their initial coverage.
 * @param chosen - Chosen coverage per prefixed name.
 * @param prefix - Key prefix (`p:` projects, `t:` tags).
 * @returns Names to add and remove.
 */
export function diffOf(
  rows: readonly CoverageRow[],
  chosen: ReadonlyMap<string, Coverage>,
  prefix: string,
): NameDiff {
  const stateOf = (row: CoverageRow): Coverage => chosen.get(prefix + row.name) ?? row.initial;
  const changed = rows.filter((row) => stateOf(row) !== row.initial);
  return {
    add: changed.filter((row) => stateOf(row) === 'all').map((row) => row.name),
    remove: changed.filter((row) => stateOf(row) === 'none').map((row) => row.name),
  };
}

/** Add/remove projects and tags on several files at once (tri-state checkboxes). */
@Component({
  selector: 'ac-relations-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    InputTextModule,
    TagChipComponent,
  ],
  templateUrl: './relations-dialog.component.html',
  styleUrl: './relations-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationsDialogComponent {
  private readonly files = inject(FilesApi);
  private readonly catalog = inject(CatalogStore);
  private readonly notify = inject(NotifyService);

  /** Dialog visibility (two-way). */
  readonly visible = model(false);
  /** Files to edit. */
  readonly paths = input.required<readonly string[]>();

  protected readonly filter = signal('');
  protected readonly saving = signal(false);
  protected readonly current = signal<RelationsByPath>({});
  protected readonly chosen = signal<ReadonlyMap<string, Coverage>>(new Map());

  protected readonly projectRows = computed(() =>
    coverageOf(
      this.catalog.projectList().map((project) => project.name),
      Object.values(this.current()).map((relations) => relations.projects),
    ),
  );
  protected readonly tagRows = computed(() =>
    coverageOf(
      this.catalog.tagList().map((tag) => tag.name),
      Object.values(this.current()).map((relations) => relations.tags),
    ),
  );
  protected readonly visibleProjects = computed(() => this.filterRows(this.projectRows()));
  protected readonly visibleTags = computed(() => this.filterRows(this.tagRows()));

  /** Load current relations whenever the dialog opens. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        void this.load();
      }
    });
  }

  /**
   * Coverage currently chosen for a name.
   *
   * @param row - Row.
   * @param prefix - `p:` for projects, `t:` for tags.
   * @returns Coverage.
   */
  protected stateOf(row: CoverageRow, prefix: string): Coverage {
    return this.chosen().get(prefix + row.name) ?? row.initial;
  }

  /**
   * Toggle a name between all and none.
   *
   * @param row - Row.
   * @param prefix - `p:` or `t:`.
   */
  protected toggle(row: CoverageRow, prefix: string): void {
    const next: Coverage = this.stateOf(row, prefix) === 'all' ? 'none' : 'all';
    this.chosen.update((map) => new Map(map).set(prefix + row.name, next));
  }

  /** Apply the changes. */
  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      const results = await this.files.patchRelations({
        paths: this.paths(),
        projects: diffOf(this.projectRows(), this.chosen(), 'p:'),
        tags: diffOf(this.tagRows(), this.chosen(), 't:'),
      });
      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) {
        this.notify.warn(`${String(failed)} file(s) could not be updated.`);
      } else {
        this.notify.success('Projects and tags updated.');
      }
      this.visible.set(false);
    } finally {
      this.saving.set(false);
    }
  }

  /** Fetch relations of the selected files. */
  private async load(): Promise<void> {
    this.chosen.set(new Map());
    this.filter.set('');
    this.current.set(await this.files.relations(this.paths()));
  }

  /**
   * Apply the text filter.
   *
   * @param rows - Rows.
   * @returns Matching rows.
   */
  private filterRows(rows: readonly CoverageRow[]): readonly CoverageRow[] {
    const query = this.filter().trim().toLowerCase();
    return query === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(query));
  }
}

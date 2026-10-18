import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  resource,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import {
  displayTitle,
  PAPER_SORTS,
  type Paper,
  paperFileName,
  paperStatus,
  shortAuthors,
  STATUS_FILTERS,
} from '@domain/sota';
import { FilesApi } from '../../core/files/files.api';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { RelationChipsComponent } from '../../shared/ui/relation-chips.component';
import { PeekService } from '../../core/files/peek.service';
import { ResearchStore } from './research.store';

/** Library tab: progress, filters, bulk actions and paper rows. */
@Component({
  selector: 'ac-research-library',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    TooltipModule,
    EmptyStateComponent,
    RelationChipsComponent,
  ],
  templateUrl: './library.panel.html',
  styleUrl: './library.panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPanelComponent {
  private readonly files = inject(FilesApi);
  protected readonly store = inject(ResearchStore);
  protected readonly peek = inject(PeekService);

  /** Edit one paper. */
  readonly edit = output<Paper>();
  /** Cite papers. */
  readonly cite = output<readonly Paper[]>();

  protected readonly statuses = STATUS_FILTERS.map((value) => ({ value, label: value }));
  protected readonly sorts = [...PAPER_SORTS];
  protected readonly relations = resource({
    params: () => this.store.papers().map((paper) => paper.path),
    loader: ({ params }) => this.files.relations(params),
  });
  protected readonly lookupTargets = computed(() =>
    this.store.selection().filter((paper) => !paper.info.validated),
  );
  protected readonly allVisibleSelected = computed(() => {
    const visible = this.store.visible();
    return visible.length > 0 && visible.every((paper) => this.store.selected().has(paper.path));
  });

  protected readonly title = displayTitle;
  protected readonly status = paperStatus;
  protected readonly fileName = paperFileName;

  /**
   * `authors · year · journal` line.
   *
   * @param paper - Paper.
   * @returns Line, or empty.
   */
  protected details(paper: Paper): string {
    return [shortAuthors(paper.info.authors), paper.info.year, paper.info.journal]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Projects and tags of a paper.
   *
   * @param paper - Paper.
   * @returns Labels.
   */
  protected labels(paper: Paper): {
    readonly projects: readonly string[];
    readonly tags: readonly string[];
  } {
    const relations = this.relations.value()?.[paper.path];
    return { projects: relations?.projects ?? [], tags: relations?.tags ?? [] };
  }

  /** Select every shown paper, or clear the selection. */
  protected toggleAll(): void {
    this.store.select(
      this.allVisibleSelected() ? [] : this.store.visible().map((paper) => paper.path),
    );
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import type { Paper } from '@domain/sota';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { CiteDialogComponent } from './cite-dialog.component';
import { ExportDialogComponent } from './export-dialog.component';
import { ImportDialogComponent } from './import-dialog.component';
import { LibraryPanelComponent } from './library.panel';
import { LookupProgressDialogComponent } from './lookup-progress-dialog.component';
import { MapPanelComponent } from './map.panel';
import { PaperDialogComponent } from './paper-dialog.component';
import { PaperViewComponent } from './paper-view.component';
import { ResearchStore } from './research.store';

/** Tab of the page. */
type ResearchTab = 'library' | 'map';

/** Research: state-of-the-art library, citation map, Zotero import/export. */
@Component({
  selector: 'ac-research-page',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    TabsModule,
    EmptyStateComponent,
    CiteDialogComponent,
    ExportDialogComponent,
    ImportDialogComponent,
    LibraryPanelComponent,
    LookupProgressDialogComponent,
    MapPanelComponent,
    PaperDialogComponent,
    PaperViewComponent,
  ],
  templateUrl: './research.page.html',
  styleUrl: './research.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResearchPage {
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogStore);
  protected readonly store = inject(ResearchStore);

  /** Query parameter: tab. */
  readonly tab = input<string | undefined>(undefined);
  /** Query parameter: path of the paper shown in the paper view. */
  readonly paper = input<string | undefined>(undefined);

  protected readonly activeTab = computed<ResearchTab>(() =>
    this.tab() === 'map' ? 'map' : 'library',
  );
  protected readonly tags = computed(() => this.catalog.tagList().map((tag) => tag.name));
  protected readonly viewed = computed(
    () => this.store.papers().find((paper) => paper.path === this.paper()) ?? null,
  );
  protected readonly editing = signal<Paper | null>(null);
  protected readonly citing = signal<readonly Paper[] | null>(null);
  protected readonly exporting = signal(false);
  protected readonly importing = signal(false);

  /**
   * Switch tab (kept in the URL).
   *
   * @param tab - Tab.
   */
  protected openTab(tab: string | number | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: tab === 'map' ? 'map' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Show one paper in the popup (kept in the URL so Back closes it).
   *
   * @param paper - Paper.
   */
  protected openPaper(paper: Paper): void {
    void this.router.navigate([], {
      queryParams: { paper: paper.path },
      queryParamsHandling: 'merge',
    });
  }

  /** Close the paper popup. */
  protected closePaper(): void {
    void this.router.navigate([], {
      queryParams: { paper: null },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Change the SOTA tag.
   *
   * @param tag - Tag.
   */
  protected async setTag(tag: string | null): Promise<void> {
    await this.store.setTag(tag);
  }
}

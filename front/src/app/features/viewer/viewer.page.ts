import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { buildSharedPath, fileKindOf, FILE_KIND_ICONS, supportsOcr } from '@domain/files';
import { parseOcr } from '@domain/mappers';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { FilesApi, triggerDownload } from '../../core/files/files.api';
import { LastOpenedService } from '../../core/files/last-opened.service';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { FileRendererComponent } from '../../shared/files/renderers/file-renderer.component';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { persistedWidth } from '../../shared/ui/persisted-width';
import { ResizeHandleComponent } from '../../shared/ui/resize-handle.component';
import { AiTabComponent } from './ai-tab.component';
import { InfoTabComponent } from './info-tab.component';
import { LinksTabComponent } from './links-tab.component';
import { NotesTabComponent } from './notes-tab.component';
import { PeopleTabComponent } from './people-tab.component';

/** Inspector tabs. */
type InspectorTab = 'info' | 'ai' | 'links' | 'notes' | 'people';

const TABS: readonly InspectorTab[] = ['info', 'ai', 'links', 'notes', 'people'];
const INSPECTOR_WIDTH_KEY = 'ac.viewer.inspectorWidth';
const DEFAULT_INSPECTOR_WIDTH = 380;

/** Full file viewer: renderer plus inspector (details, AI, links, notes, people). */
@Component({
  selector: 'ac-viewer-page',
  imports: [
    RouterLink,
    ButtonModule,
    TabsModule,
    TooltipModule,
    RelativeDatePipe,
    EmptyStateComponent,
    ResizeHandleComponent,
    FileRendererComponent,
    InfoTabComponent,
    AiTabComponent,
    LinksTabComponent,
    NotesTabComponent,
    PeopleTabComponent,
  ],
  templateUrl: './viewer.page.html',
  styleUrl: './viewer.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerPage {
  private readonly files = inject(FilesApi);
  private readonly details = inject(FileDetailsApi);
  private readonly sync = inject(DataSync);
  private readonly lastOpened = inject(LastOpenedService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Route parameter: date folder. */
  readonly date = input.required<string>();
  /** Route parameter: subfolder. */
  readonly folder = input.required<string>();
  /** Route parameter: file name. */
  readonly name = input.required<string>();
  /** Query parameter: inspector tab. */
  readonly tab = input<string | undefined>(undefined);

  protected readonly path = computed(() =>
    buildSharedPath({ date: this.date(), folder: this.folder(), name: this.name() }),
  );
  protected readonly activeTab = linkedSignal<InspectorTab>(
    () => TABS.find((tab) => tab === this.tab()) ?? 'info',
  );
  protected readonly showBoxes = signal(false);
  protected readonly showScores = signal(false);

  protected readonly metadata = resource({
    params: () => ({ path: this.path(), version: this.sync.version('files')() }),
    loader: ({ params }) => this.files.metadata(params.path),
  });
  protected readonly kind = computed(() =>
    fileKindOf(this.path(), this.metadata.value()?.mime_type),
  );
  protected readonly icon = computed(() => FILE_KIND_ICONS[this.kind()]);
  protected readonly pinned = resource({
    params: () => ({ path: this.path(), version: this.sync.version('pinned')() }),
    loader: ({ params }) => this.details.isPinned(params.path),
  });
  protected readonly ocrRecord = resource({
    params: () =>
      supportsOcr(this.kind())
        ? { path: this.path(), version: this.sync.version('jobs')() }
        : undefined,
    loader: ({ params }) => this.details.ocr(params.path),
  });
  protected readonly ocr = computed(() => parseOcr(this.ocrRecord.value()?.ocr));
  protected readonly missing = computed(
    () => !this.metadata.isLoading() && this.metadata.value() === null,
  );
  protected readonly inspectorWidth = persistedWidth(INSPECTOR_WIDTH_KEY, DEFAULT_INSPECTOR_WIDTH);

  /** Record visits for "recently opened". */
  constructor() {
    effect(() => {
      const path = this.path();
      untracked(() => {
        this.lastOpened.record(path);
        void this.details.recordOpened(path);
      });
    });
  }

  /** Restore the default inspector width. */
  protected resetInspectorWidth(): void {
    this.inspectorWidth.set(DEFAULT_INSPECTOR_WIDTH);
  }

  /**
   * Switch tab (kept in the URL).
   *
   * @param tab - Tab value.
   */
  protected selectTab(tab: string | number | undefined): void {
    const next = TABS.find((candidate) => candidate === tab) ?? 'info';
    this.activeTab.set(next);
    void this.router.navigate([], {
      queryParams: { tab: next === 'info' ? null : next },
      replaceUrl: true,
    });
  }

  /** Go back (or to the library). */
  protected back(): void {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/library']);
    }
  }

  /** Toggle the pin. */
  protected async togglePin(): Promise<void> {
    await this.details.setPinned(this.path(), this.pinned.value() !== true);
  }

  /** Download the file. */
  protected download(): void {
    triggerDownload(this.files.contentUrl(this.path(), 'attachment'));
  }

  /** Open the raw file in a new tab. */
  protected openRaw(): void {
    window.open(this.files.contentUrl(this.path()), '_blank', 'noopener');
  }

  /** Confirm and delete. */
  protected remove(): void {
    this.confirm.confirm({
      header: 'Delete file',
      message: `Delete ${this.name()}? Its note, OCR, summary and links are deleted too. This cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.deleteNow(),
    });
  }

  /** Delete and leave the page. */
  private async deleteNow(): Promise<void> {
    const [result] = await this.files.delete([this.path()]);
    if (result?.ok === true) {
      this.notify.success('File deleted.');
      await this.router.navigate(['/library']);
    } else {
      this.notify.error('Could not delete the file.', result?.message);
    }
  }
}

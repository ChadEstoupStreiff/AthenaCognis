import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import {
  displayTitle,
  INFO_TEXT_FIELDS,
  type Paper,
  type PaperInfo,
  paperFileName,
  paperStatus,
  paperUploadDate,
} from '@domain/sota';
import { FilesApi, triggerDownload } from '../../core/files/files.api';
import { DataSync } from '../../core/state/data-sync.service';
import { viewerCommands } from '../../shared/files/file-row';
import { FileRendererComponent } from '../../shared/files/renderers/file-renderer.component';
import { persistedWidth } from '../../shared/ui/persisted-width';
import { RelationChipsComponent } from '../../shared/ui/relation-chips.component';
import { ResizeHandleComponent } from '../../shared/ui/resize-handle.component';
import { paperDetails, STATUS_ICONS } from './paper-labels';
import { PaperFormComponent } from './paper-form.component';
import { ResearchStore } from './research.store';

const DOI_BASE_URL = 'https://doi.org/';
const SIDE_WIDTH_KEY = 'ac.research.paperSideWidth';
const DEFAULT_SIDE_WIDTH = 460;
const SIDE_MIN_WIDTH = 320;
const PREVIEW_MIN_WIDTH = 360;

/** One paper: actions and reference on the left, file preview on the right, resizable split. */
@Component({
  selector: 'ac-paper-view',
  imports: [
    ButtonModule,
    TooltipModule,
    FileRendererComponent,
    PaperFormComponent,
    RelationChipsComponent,
    ResizeHandleComponent,
  ],
  templateUrl: './paper-view.component.html',
  styleUrl: './paper-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperViewComponent {
  private readonly files = inject(FilesApi);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);
  protected readonly store = inject(ResearchStore);

  /** Paper shown. */
  readonly paper = input.required<Paper>();
  /** Back to the library. */
  readonly closed = output();
  /** Cite the paper. */
  readonly cite = output<readonly Paper[]>();

  /** Reference being edited (reset when the stored paper changes). */
  protected readonly draft = linkedSignal<PaperInfo>(() => this.paper().info);
  protected readonly dirty = computed(() =>
    INFO_TEXT_FIELDS.some((field) => this.draft()[field] !== this.paper().info[field]),
  );
  protected readonly saving = signal(false);
  /** Publication page: its URL, else its DOI link. */
  protected readonly webUrl = computed(() => {
    const { url, doi } = this.paper().info;
    if (url.trim()) {
      return url.trim();
    }
    return doi.trim() ? `${DOI_BASE_URL}${doi.trim()}` : null;
  });
  protected readonly status = computed(() => paperStatus(this.paper()));
  protected readonly busy = computed(() => this.store.busy().has(this.paper().path));
  protected readonly relations = resource({
    params: () => ({ path: this.paper().path, version: this.sync.version('files')() }),
    loader: async ({ params }) => (await this.files.relations([params.path]))[params.path],
  });
  protected readonly sideWidth = persistedWidth(SIDE_WIDTH_KEY, DEFAULT_SIDE_WIDTH);
  protected readonly sideMinWidth = SIDE_MIN_WIDTH;
  protected readonly previewMinWidth = PREVIEW_MIN_WIDTH;

  protected readonly title = displayTitle;
  protected readonly details = paperDetails;
  protected readonly fileName = paperFileName;
  protected readonly uploadDate = paperUploadDate;
  protected readonly statusIcons = STATUS_ICONS;

  /** Restore the default side panel width. */
  protected resetSideWidth(): void {
    this.sideWidth.set(DEFAULT_SIDE_WIDTH);
  }

  /**
   * Save the draft reference (and optionally validate).
   *
   * @param validate - Mark validated.
   */
  protected async save(validate: boolean): Promise<void> {
    const paper = this.paper();
    this.saving.set(true);
    try {
      const info = { ...this.draft(), validated: validate || paper.info.validated };
      await this.store.save(new Map([[paper.path, info]]));
    } finally {
      this.saving.set(false);
    }
  }

  /** Drop unsaved edits. */
  protected revert(): void {
    this.draft.set(this.paper().info);
  }

  /** Open the paper in the full file viewer. */
  protected openViewer(): void {
    void this.router.navigate(viewerCommands(this.paper().path));
  }

  /** Open the publication page in a new tab. */
  protected openWeb(): void {
    const url = this.webUrl();
    if (url !== null) {
      window.open(url, '_blank', 'noopener');
    }
  }

  /** Download the file. */
  protected download(): void {
    triggerDownload(this.files.contentUrl(this.paper().path, 'attachment'));
  }
}

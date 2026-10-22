import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { fileKindOf, supportsOcr } from '@domain/files';
import { parseOcr } from '@domain/mappers';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { FilesApi, triggerDownload } from '../../core/files/files.api';
import { PeekService } from '../../core/files/peek.service';
import { DataSync } from '../../core/state/data-sync.service';
import { toFileRow, viewerCommands } from '../../shared/files/file-row';
import { FileRendererComponent } from '../../shared/files/renderers/file-renderer.component';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { AiTabComponent } from './ai-tab.component';
import { InfoTabComponent } from './info-tab.component';
import { LinksTabComponent } from './links-tab.component';
import { NotesTabComponent } from './notes-tab.component';
import { PeopleTabComponent } from './people-tab.component';
import { SummaryBlockComponent } from './summary-block.component';

/** Tabs of the side panel. */
type PeekTab = 'overview' | 'ai' | 'links' | 'notes';

const TABS: readonly PeekTab[] = ['overview', 'ai', 'links', 'notes'];

/** File side panel (click / Space on any file): preview, summary, projects, tags, people, AI, links, note. */
@Component({
  selector: 'ac-file-peek',
  imports: [
    RouterLink,
    ButtonModule,
    DrawerModule,
    TabsModule,
    TooltipModule,
    BytesPipe,
    RelativeDatePipe,
    FileRendererComponent,
    AiTabComponent,
    InfoTabComponent,
    LinksTabComponent,
    NotesTabComponent,
    PeopleTabComponent,
    SummaryBlockComponent,
  ],
  templateUrl: './file-peek.component.html',
  styleUrl: './file-peek.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilePeekComponent {
  protected readonly peek = inject(PeekService);
  private readonly files = inject(FilesApi);
  private readonly details = inject(FileDetailsApi);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);

  protected readonly row = computed(() => {
    const path = this.peek.path();
    return path === null ? null : toFileRow(path);
  });
  /**
   * Body rendered once the slide-in has painted (reset on open and close): rendering it with the drawer
   * blocks the first animation frames, so the drawer and its mask pop in instead of sliding.
   */
  protected readonly bodyReady = linkedSignal({
    source: () => this.peek.path() !== null,
    computation: () => false,
  });
  protected readonly tab = signal<PeekTab>('overview');
  protected readonly showBoxes = signal(false);
  protected readonly showScores = signal(false);

  protected readonly metadata = resource({
    params: () => {
      const path = this.peek.path();
      return path === null ? undefined : { path, version: this.sync.version('files')() };
    },
    loader: ({ params }) => this.files.metadata(params.path),
  });
  protected readonly kind = computed(() =>
    fileKindOf(this.peek.path() ?? '', this.metadata.value()?.mime_type),
  );
  protected readonly pinned = resource({
    params: () => {
      const path = this.peek.path();
      return path === null ? undefined : { path, version: this.sync.version('pinned')() };
    },
    loader: ({ params }) => this.details.isPinned(params.path),
  });
  protected readonly ocrRecord = resource({
    params: () => {
      const path = this.peek.path();
      return path === null || !supportsOcr(this.kind())
        ? undefined
        : { path, version: this.sync.version('jobs')() };
    },
    loader: ({ params }) => this.details.ocr(params.path),
  });
  protected readonly ocr = computed(() => parseOcr(this.ocrRecord.value()?.ocr));

  /**
   * Switch tab.
   *
   * @param value - Tab value.
   */
  protected selectTab(value: string | number | undefined): void {
    this.tab.set(TABS.find((candidate) => candidate === value) ?? 'overview');
  }

  /** Render the body after the drawer's first animation frame has painted. */
  protected revealBody(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.bodyReady.set(true);
      });
    });
  }

  /** Open the full viewer. */
  protected open(): void {
    const path = this.peek.path();
    if (path !== null) {
      this.peek.close();
      void this.router.navigate(viewerCommands(path));
    }
  }

  /** Download the file. */
  protected download(): void {
    const path = this.peek.path();
    if (path !== null) {
      triggerDownload(this.files.contentUrl(path, 'attachment'));
    }
  }

  /** Pin or unpin. */
  protected async togglePin(): Promise<void> {
    const path = this.peek.path();
    if (path !== null) {
      await this.details.setPinned(path, this.pinned.value() !== true);
    }
  }
}

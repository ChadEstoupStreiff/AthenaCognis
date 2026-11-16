import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  DOCUMENT_TREE_DEFAULTS,
  DOCUMENT_TREE_LIMITS,
  type DocumentTreeParams,
  type DocumentTreeSection,
  type JobTask,
} from '@domain/contracts';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { triggerDownload } from '../../core/files/files.api';
import { jobFailure } from '../../core/jobs/job-error';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import {
  allSectionIds,
  countSections,
  DEPTH_COLORS,
  rangeBlocks,
  rangeLabel,
  sanitizeTreeParams,
  treeDepth,
  treeExportName,
  treeJson,
} from '../../core/tree/document-tree';

const POLL_MS = 4_000;
const OPEN_STATES: ReadonlySet<string> = new Set(['PENDING', 'IN_PROGRESS']);

/** AI section tree of a document: generation form, expandable outline down to the text, JSON export. */
@Component({
  selector: 'ac-document-tree',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    TagModule,
    ToggleSwitchModule,
  ],
  templateUrl: './document-tree.component.html',
  styleUrls: ['./inspector.scss', './document-tree.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentTreeComponent {
  private readonly details = inject(FileDetailsApi);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly limits = DOCUMENT_TREE_LIMITS;
  protected readonly rangeLabel = rangeLabel;

  private readonly params = computed(() => ({
    path: this.path(),
    version: this.sync.version('jobs')(),
  }));

  protected readonly record = resource({
    params: this.params,
    loader: ({ params }) => this.details.tree(params.path),
  });
  protected readonly latestTask = resource({
    params: this.params,
    loader: async ({ params }): Promise<JobTask | null> => {
      const tasks = await this.details.tasks('tree', params.path);
      return [...tasks].sort((left, right) => right.added.localeCompare(left.added))[0] ?? null;
    },
  });

  /** Form values (reset to the stored tree's parameters when it changes). */
  protected readonly form = linkedSignal<DocumentTreeParams>(() => ({
    ...DOCUMENT_TREE_DEFAULTS,
    ...this.record.value()?.params,
  }));
  protected readonly formOpen = linkedSignal(() => !this.record.value());
  /** Expanded section ids (all collapsed when the tree changes). */
  protected readonly expanded = linkedSignal({
    source: this.record.value,
    computation: (): ReadonlySet<string> => new Set(),
  });
  /** Document blocks are fetched once, on the first leaf opened. */
  private readonly blocksWanted = signal(false);
  protected readonly blocks = resource({
    params: () =>
      this.blocksWanted() && this.record.value()
        ? { path: this.path(), date: this.record.value()?.date }
        : undefined,
    loader: ({ params }) => this.details.treeBlocks(params.path),
  });

  protected readonly running = computed(() =>
    OPEN_STATES.has(this.latestTask.value()?.state ?? ''),
  );
  protected readonly failure = computed(() => {
    const task = this.latestTask.value();
    return task ? jobFailure(task) : null;
  });
  protected readonly stats = computed(() => {
    const tree = this.record.value()?.tree ?? [];
    return { sections: countSections(tree), depth: treeDepth(tree) };
  });
  protected readonly stale = computed(() => {
    const blocks = this.blocks.value();
    const record = this.record.value();
    return !!blocks && !!record && blocks.block_count !== record.block_count;
  });
  protected readonly allExpanded = computed(
    () => this.expanded().size === this.stats().sections && this.stats().sections > 0,
  );

  /** Poll the task while it runs; reload the tree when it ends. */
  constructor() {
    let timer: ReturnType<typeof setInterval> | undefined;
    let wasRunning = false;
    effect(() => {
      const running = this.running();
      clearInterval(timer);
      timer = running
        ? setInterval(() => {
            this.latestTask.reload();
          }, POLL_MS)
        : undefined;
      if (wasRunning && !running) {
        this.record.reload();
      }
      wasRunning = running;
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }

  /**
   * Update one form field.
   *
   * @param patch - Changed fields.
   */
  protected patchForm(patch: Partial<DocumentTreeParams>): void {
    this.form.update((current) => ({ ...current, ...patch }));
  }

  /** Queue the tree generation with the form parameters. */
  protected async generate(): Promise<void> {
    try {
      await this.details.askTree(this.path(), sanitizeTreeParams(this.form()));
    } catch {
      return;
    }
    this.formOpen.set(false);
    this.notify.info('Section tree requested', 'It appears here when the job completes.');
  }

  /**
   * Whether a section is expanded.
   *
   * @param section - Section.
   * @returns Expanded state.
   */
  protected isOpen(section: DocumentTreeSection): boolean {
    return this.expanded().has(section.section_id);
  }

  /**
   * Expand or collapse a section; a leaf expands into its text.
   *
   * @param section - Clicked section.
   */
  protected toggle(section: DocumentTreeSection): void {
    const next = new Set(this.expanded());
    if (next.delete(section.section_id)) {
      this.expanded.set(next);
      return;
    }
    next.add(section.section_id);
    this.expanded.set(next);
    if (section.sections.length === 0) {
      this.blocksWanted.set(true);
    }
  }

  /** Expand every section: the whole paper, ordered by the tree. */
  protected expandAll(): void {
    this.expanded.set(new Set(allSectionIds(this.record.value()?.tree ?? [])));
    this.blocksWanted.set(true);
  }

  /** Collapse every section. */
  protected collapseAll(): void {
    this.expanded.set(new Set());
  }

  /**
   * Bar color class of a depth.
   *
   * @param depth - Depth, 0 = top.
   * @returns CSS class.
   */
  protected depthClass(depth: number): string {
    return `depth-${String(depth % DEPTH_COLORS)}`;
  }

  /**
   * Text blocks of a leaf section.
   *
   * @param section - Leaf section.
   * @returns Blocks.
   */
  protected leafBlocks(section: DocumentTreeSection): readonly string[] {
    return rangeBlocks(this.blocks.value()?.blocks ?? [], section.paper_section_range);
  }

  /** Download the tree as JSON (sections and block ranges, no document text). */
  protected exportJson(): void {
    const tree = this.record.value()?.tree ?? [];
    const url = URL.createObjectURL(new Blob([treeJson(tree)], { type: 'application/json' }));
    triggerDownload(url, treeExportName(this.path()));
    setTimeout(() => {
      URL.revokeObjectURL(url);
    });
  }
}

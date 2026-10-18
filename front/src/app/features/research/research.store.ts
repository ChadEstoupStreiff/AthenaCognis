import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import {
  analyzePaper,
  type CitationRecord,
  displayTitle,
  filterPapers,
  lookupPaper,
  type Paper,
  type PaperInfo,
  type PaperSort,
  paperStatus,
  sortPapers,
  type StatusFilter,
} from '@domain/sota';
import { JobsStore } from '../../core/jobs/jobs.store';
import { NotifyService } from '../../core/notify/notify.service';
import { SotaOnline } from '../../core/sota/sota-online';
import { SotaStorage } from '../../core/sota/sota-storage';
import { DataSync } from '../../core/state/data-sync.service';

/** Research library state (kept across navigation so background lookups land in the review queue). */
@Injectable({ providedIn: 'root' })
export class ResearchStore {
  private readonly storage = inject(SotaStorage);
  private readonly online = inject(SotaOnline);
  private readonly jobs = inject(JobsStore);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);

  /** SOTA tag. */
  readonly tag = resource({
    params: () => this.sync.version('sota')(),
    loader: () => this.storage.tag(),
  });
  private readonly loaded = resource({
    params: () => {
      const tag = this.tag.value();
      return tag === null || tag === undefined
        ? undefined
        : { tag, files: this.sync.version('files')() };
    },
    loader: ({ params }) => this.storage.library(params.tag),
  });

  /** Papers (patched locally after saves). */
  readonly papers = linkedSignal<readonly Paper[]>(() => this.loaded.value() ?? []);
  /** Library is loading. */
  readonly loading = computed(() => this.tag.isLoading() || this.loaded.isLoading());
  /** Selected paths. */
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly status = signal<StatusFilter>('All');
  readonly query = signal('');
  readonly sort = signal<PaperSort>('Newest first');
  /** Citation records (loaded with the map). */
  readonly records = signal<ReadonlyMap<string, CitationRecord>>(new Map());
  /** Paths being processed. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** Operation id of the metadata lookup shown in the progress dialog. */
  private readonly lookupId = signal<string | null>(null);
  /** Title of the paper being looked up. */
  readonly lookupCurrent = signal<string | null>(null);
  /** Metadata lookup shown in the progress dialog. */
  readonly lookupOperation = computed(() => {
    const id = this.lookupId();
    return id === null ? null : (this.jobs.operations().find((op) => op.id === id) ?? null);
  });

  /** Warn before closing the tab while a lookup runs (it runs in this tab). */
  constructor() {
    const warn = (event: BeforeUnloadEvent): void => {
      if (this.lookupOperation()?.status === 'running') {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeunload', warn);
    });
  }

  /** Papers matching the filters, sorted. */
  readonly visible = computed(() =>
    sortPapers(filterPapers(this.papers(), this.status(), this.query()), this.sort()),
  );
  /** Selected papers. */
  readonly selection = computed(() =>
    this.papers().filter((paper) => this.selected().has(paper.path)),
  );
  /** Counts per status. */
  readonly counts = computed(() => {
    const counts = { Validated: 0, 'To review': 0, 'Missing info': 0 };
    this.papers().forEach((paper) => (counts[paperStatus(paper)] += 1));
    return counts;
  });

  /**
   * Change the SOTA tag.
   *
   * @param tag - Tag.
   */
  async setTag(tag: string | null): Promise<void> {
    this.selected.set(new Set());
    this.records.set(new Map());
    await this.storage.setTag(tag);
  }

  /**
   * Toggle one paper in the selection.
   *
   * @param path - Paper.
   */
  toggle(path: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  }

  /**
   * Replace the selection.
   *
   * @param paths - Paths.
   */
  select(paths: readonly string[]): void {
    this.selected.set(new Set(paths));
  }

  /**
   * Save new metadata of papers.
   *
   * @param updates - Paper path → metadata.
   * @returns Number saved.
   */
  async save(updates: ReadonlyMap<string, PaperInfo>): Promise<number> {
    let saved = 0;
    for (const paper of this.papers().filter((item) => updates.has(item.path))) {
      const next: Paper = { path: paper.path, info: updates.get(paper.path) ?? paper.info };
      try {
        await this.storage.saveInfo(next);
        this.patch(next);
        saved += 1;
      } catch {
        this.notify.error(`Could not save ${paper.path.split('/').at(-1) ?? ''}.`);
      }
    }
    return saved;
  }

  /**
   * Mark papers validated or not.
   *
   * @param papers - Papers.
   * @param validated - Flag.
   */
  async setValidated(papers: readonly Paper[], validated: boolean): Promise<void> {
    const saved = await this.save(
      new Map(papers.map((paper) => [paper.path, { ...paper.info, validated }])),
    );
    this.notify.success(
      `${String(saved)} paper(s) ${validated ? 'validated' : 'marked to review'}.`,
    );
  }

  /**
   * Look papers up online in the background; save each result as "To review".
   *
   * @param papers - Papers (validated ones are skipped).
   */
  findInfo(papers: readonly Paper[]): void {
    const targets = papers.filter((paper) => !paper.info.validated);
    const operation = this.jobs.track(
      'sota-lookup',
      `Find metadata of ${String(targets.length)} paper(s)`,
      async (progress) => {
        progress.setTotal(targets.length);
        let found = 0;
        for (const paper of targets) {
          this.lookupCurrent.set(displayTitle(paper));
          const result = await this.withBusy(paper.path, () =>
            lookupPaper(paper, this.online.lookup),
          );
          if (result !== null) {
            found += await this.save(new Map([[paper.path, result.info]]));
          }
          progress.step(`${String(found)} saved`);
        }
        this.lookupCurrent.set(null);
        return `Metadata found and saved for ${String(found)} / ${String(targets.length)} paper(s). Check them under "To review".`;
      },
    );
    this.lookupId.set(operation.id);
  }

  /** Hide the lookup progress dialog. */
  closeLookup(): void {
    this.lookupId.set(null);
  }

  /** Load citation records of the library. */
  async loadRecords(): Promise<void> {
    this.records.set(await this.storage.records(this.papers()));
  }

  /**
   * Find and store references of papers (background).
   *
   * @param papers - Papers.
   */
  analyze(papers: readonly Paper[]): void {
    this.jobs.track(
      'sota-citations',
      `Find references of ${String(papers.length)} paper(s)`,
      async (progress) => {
        progress.setTotal(papers.length);
        let found = 0;
        for (const paper of papers) {
          const record = await this.withBusy(paper.path, () =>
            analyzePaper(paper, this.online.citations),
          );
          await this.storage.saveRecord(paper, record).catch(() => undefined);
          this.records.update((current) => new Map(current).set(paper.path, record));
          found += record.references.length > 0 ? 1 : 0;
          progress.step(`${String(found)} with references`);
        }
        return `References found for ${String(found)} / ${String(papers.length)} paper(s).`;
      },
    );
  }

  /**
   * Replace one paper locally.
   *
   * @param paper - Updated paper.
   */
  private patch(paper: Paper): void {
    this.papers.update((list) => list.map((item) => (item.path === paper.path ? paper : item)));
  }

  /**
   * Mark a paper busy while a task runs.
   *
   * @param path - Paper.
   * @param task - Work.
   * @returns Task result.
   */
  private async withBusy<T>(path: string, task: () => Promise<T>): Promise<T> {
    this.busy.update((current) => new Set(current).add(path));
    try {
      return await task();
    } finally {
      this.busy.update((current) => new Set([...current].filter((item) => item !== path)));
    }
  }
}

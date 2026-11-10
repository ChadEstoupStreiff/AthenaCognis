import { computed, inject, Injectable, linkedSignal, signal } from '@angular/core';
import {
  aiPaperContext,
  applyResultFilters,
  combineHits,
  type DiscoverRequest,
  defaultDiscoverRequest,
  discoverRange,
  filterHits,
  NO_RESULT_FILTERS,
  type ResultFilters,
  findInLibrary,
  hitFileName,
  isTextScope,
  type Paper,
  type PaperScope,
  SEARCH_SOURCES,
  type SearchHit,
  type SearchQuery,
  type SearchSort,
  type SearchSource,
  seedPapers,
  type SeedTopic,
  sortHits,
  type TextScope,
} from '@domain/sota';
import { FilesApi } from '../../core/files/files.api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { NotifyService } from '../../core/notify/notify.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { type DiscoverOutcome, SotaDiscover } from '../../core/sota/sota-discover';
import { type SourceFailure, SotaSearch } from '../../core/sota/sota-search';
import { SotaStorage } from '../../core/sota/sota-storage';
import { TelemetryService } from '../../core/telemetry/telemetry.service';
import { ResearchStore } from './research.store';
import { LibraryTransfer } from './transfer';

/** Import progress of one hit. */
export interface HitImport {
  readonly status: 'running' | 'done' | 'failed';
  readonly message: string;
}

/** Filters of the search form. */
export interface SearchFilters {
  readonly sources: readonly SearchSource[];
  readonly yearFrom: number | null;
  readonly yearTo: number | null;
  readonly withPdfOnly: boolean;
}

/** Search or discovery mode of the tab. */
export type SearchMode = 'search' | 'discover';

/** Where the shown results come from. */
export type ResultsOrigin =
  | { readonly kind: 'search'; readonly query: SearchQuery }
  | {
      readonly kind: 'discover';
      readonly request: DiscoverRequest;
      readonly seeds: number;
      readonly resolved: number;
      readonly topics: readonly SeedTopic[];
      /** Run by the AI search. */
      readonly ai: boolean;
      /** Queries written by the AI. */
      readonly queries: readonly string[];
    };

/** One discovery to run. */
interface DiscoveryRun {
  readonly request: DiscoverRequest;
  readonly ai: boolean;
  /** Number of seed papers (0 for text scopes). */
  readonly seeds: number;
  /** Reason not to run, or null. */
  readonly blocker: string | null;
  readonly task: () => Promise<DiscoverOutcome>;
}

/** Message when a text scope has no text. */
const TEXT_BLOCKERS: Readonly<Record<TextScope, string>> = {
  subject: 'Write your subject in Settings → Research first.',
  custom: 'Write what to look for in the Custom box first.',
};

/** Reason shown on hits of a text scope. */
const TEXT_REASONS: Readonly<Record<TextScope, string>> = {
  subject: 'Matches your subject',
  custom: 'Matches your text',
};

/**
 * Reason not to run a discovery based on library papers.
 *
 * @param scope - Scope.
 * @param seeds - Number of seed papers.
 * @param untitled - The AI would get no title.
 * @returns Message, or null to run.
 */
function seedBlocker(scope: PaperScope, seeds: number, untitled: boolean): string | null {
  if (seeds === 0) {
    return scope === 'recent'
      ? 'No paper was added to the library in the last month.'
      : 'The library is empty.';
  }
  return untitled ? 'None of these papers has a title yet (Library → Find info).' : null;
}

const DEFAULT_FILTERS: SearchFilters = {
  sources: SEARCH_SOURCES,
  yearFrom: null,
  yearTo: null,
  withPdfOnly: false,
};

/** Online paper search and one-click import into the SOTA library (kept across navigation). */
@Injectable({ providedIn: 'root' })
export class SearchStore {
  private readonly search = inject(SotaSearch);
  private readonly discoverer = inject(SotaDiscover);
  private readonly settings = inject(SettingsStore);
  private readonly research = inject(ResearchStore);
  private readonly storage = inject(SotaStorage);
  private readonly transfer = inject(LibraryTransfer);
  private readonly files = inject(FilesApi);
  private readonly jobs = inject(JobsStore);
  private readonly notify = inject(NotifyService);
  private readonly telemetry = inject(TelemetryService);

  /** Text typed in the search box. */
  readonly text = signal('');
  /** Form filters. */
  readonly filters = signal<SearchFilters>(DEFAULT_FILTERS);
  /** Search or discovery form shown. */
  readonly mode = signal<SearchMode>('search');
  /** Default "Based on" selection (Settings → Research). */
  private readonly defaultScope = computed(() => this.settings.get('research_default_scope'));
  /** Default "Published" selection (Settings → Research). */
  private readonly defaultPeriod = computed(() => this.settings.get('research_default_period'));
  /** Discovery settings (reset when the default selections change). */
  readonly discoverRequest = linkedSignal<DiscoverRequest>(() =>
    defaultDiscoverRequest(this.defaultScope(), this.defaultPeriod()),
  );
  /** Filters of the shown results. */
  readonly resultFilters = signal<ResultFilters>(NO_RESULT_FILTERS);
  /** Subject written in Settings → Research. */
  readonly subject = computed(() => this.settings.get('research_subject').trim());
  /** Order of the shown results (applied instantly). */
  readonly sort = signal<SearchSort>('relevance');
  /** Origin of the shown results (null before the first run). */
  readonly origin = signal<ResultsOrigin | null>(null);
  /** Query of the shown search results. */
  readonly query = computed(() => {
    const origin = this.origin();
    return origin?.kind === 'search' ? origin.query : null;
  });
  /** Blocking error of the last run. */
  readonly error = signal<string | null>(null);
  /** Combined hits of every loaded page. */
  private readonly hits = signal<readonly SearchHit[]>([]);
  readonly loading = signal(false);
  readonly failures = signal<readonly SourceFailure[]>([]);
  readonly exhausted = signal(true);
  /** Import state per hit key. */
  readonly imports = signal<ReadonlyMap<string, HitImport>>(new Map());

  /** Hits of the current run (search year / PDF filters applied). */
  readonly loaded = computed(() => {
    const origin = this.origin();
    if (origin === null) {
      return [];
    }
    return origin.kind === 'search' ? filterHits(this.hits(), origin.query) : this.hits();
  });
  /** Library paper of each loaded hit (by key). */
  readonly inLibrary = computed(() => {
    const papers = this.research.papers();
    return new Map(
      this.loaded()
        .map((hit) => [hit.key, findInLibrary(hit, papers)] as const)
        .filter((entry): entry is readonly [string, Paper] => entry[1] !== null),
    );
  });
  /** Loaded hits passing the result filters, in the chosen order. */
  readonly results = computed(() =>
    sortHits(
      applyResultFilters(this.loaded(), this.resultFilters(), new Set(this.inLibrary().keys())),
      this.sort(),
    ),
  );
  /** Shown hits that can be imported in bulk (PDF link known, not imported yet). */
  readonly importable = computed(() =>
    this.results().filter(
      (hit) =>
        hit.pdfUrls.length > 0 &&
        !this.inLibrary().has(hit.key) &&
        this.imports().get(hit.key)?.status !== 'running' &&
        this.imports().get(hit.key)?.status !== 'done',
    ),
  );

  /**
   * Update some filters.
   *
   * @param patch - Changed filters.
   */
  setFilters(patch: Partial<SearchFilters>): void {
    this.filters.update((current) => ({ ...current, ...patch }));
  }

  /** Run a new search from the form (first page). */
  async run(): Promise<void> {
    const text = this.text().trim();
    if (text === '' || this.filters().sources.length === 0) {
      return;
    }
    this.hits.set([]);
    this.telemetry.track('research_searches');
    await this.load({ ...this.filters(), text, page: 1 });
  }

  /**
   * Update some result filters.
   *
   * @param patch - Changed filters.
   */
  setResultFilters(patch: Partial<ResultFilters>): void {
    this.resultFilters.update((current) => ({ ...current, ...patch }));
  }

  /** Find papers related to the library, the papers added last month, the subject or a custom text. */
  async discover(): Promise<void> {
    await this.runDiscovery(this.discoveryRun(false));
  }

  /** Let the paper-search AI write OpenAlex queries from the "Based on" selection, then run them. */
  async discoverWithAi(): Promise<void> {
    await this.runDiscovery(this.discoveryRun(true));
  }

  /** Load the next page of the current search. */
  async loadMore(): Promise<void> {
    const query = this.query();
    if (query !== null && !this.exhausted() && !this.loading()) {
      await this.load({ ...query, page: query.page + 1 });
    }
  }

  /**
   * Import hits one after the other (one background job).
   *
   * @param hits - Hits.
   */
  importMany(hits: readonly SearchHit[]): void {
    const tag = this.research.tag.value();
    if (tag === null || tag === undefined || hits.length === 0) {
      return;
    }
    this.jobs.track('sota-import', `Import ${String(hits.length)} paper(s)`, async (progress) => {
      progress.setTotal(hits.length);
      let imported = 0;
      for (const hit of hits) {
        imported += (await this.importOne(hit, tag, null)) ? 1 : 0;
        progress.step(`${String(imported)} imported`);
      }
      if (imported > 0) {
        this.files.uploadsFinished();
      }
      return `${String(imported)} / ${String(hits.length)} paper(s) imported. Check them under "To review".`;
    });
  }

  /**
   * Import one hit, from its PDF link or from a PDF the user picked.
   *
   * @param hit - Hit.
   * @param file - PDF downloaded by the user, or null to download it.
   */
  importHit(hit: SearchHit, file: File | null = null): void {
    const tag = this.research.tag.value();
    if (tag === null || tag === undefined) {
      return;
    }
    this.jobs.track('sota-import', `Import “${hit.info.title}”`, async () => {
      const imported = await this.importOne(hit, tag, file);
      if (!imported) {
        this.notify.error(`Import failed: ${this.imports().get(hit.key)?.message ?? ''}`);
        return null;
      }
      this.files.uploadsFinished();
      this.notify.success(`“${hit.info.title}” added to the library.`);
      return 'Paper imported.';
    });
  }

  /**
   * Discovery of the current "Based on" selection.
   *
   * @param ai - Let the AI write the queries.
   * @returns Run.
   */
  private discoveryRun(ai: boolean): DiscoveryRun {
    const request = this.discoverRequest();
    const library = this.research.papers();
    const range = discoverRange(request, new Date());
    if (isTextScope(request.scope)) {
      const scope = request.scope;
      const text = scope === 'subject' ? this.subject() : request.custom.trim();
      return {
        request,
        ai,
        seeds: 0,
        blocker: text === '' ? TEXT_BLOCKERS[scope] : null,
        task: ai
          ? () => this.discoverer.byAi(text, 'description', library, range)
          : () => this.discoverer.bySubject(text, library, range, TEXT_REASONS[scope]),
      };
    }
    const seeds = seedPapers(library, request.scope, new Date());
    const context = aiPaperContext(seeds);
    return {
      request,
      ai,
      seeds: seeds.length,
      blocker: seedBlocker(request.scope, seeds.length, ai && context === ''),
      task: ai
        ? () => this.discoverer.byAi(context, 'papers', library, range)
        : () => this.discoverer.discover(seeds, library, range),
    };
  }

  /**
   * Show the outcome of a discovery.
   *
   * @param run - Discovery.
   */
  private async runDiscovery(run: DiscoveryRun): Promise<void> {
    const { request, ai, seeds, blocker } = run;
    this.hits.set([]);
    this.failures.set([]);
    this.exhausted.set(true);
    this.error.set(blocker);
    this.origin.set({ kind: 'discover', request, seeds, resolved: 0, topics: [], ai, queries: [] });
    if (blocker !== null) {
      return;
    }
    this.loading.set(true);
    this.telemetry.track('research_discoveries');
    try {
      const outcome = await run.task();
      this.hits.set(outcome.hits);
      this.origin.set({
        kind: 'discover',
        request,
        seeds,
        resolved: outcome.resolved,
        topics: outcome.topics,
        ai,
        queries: outcome.queries,
      });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Run a query and merge its hits into the shown ones.
   *
   * @param query - Query.
   */
  private async load(query: SearchQuery): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.origin.set({ kind: 'search', query });
    try {
      const page = await this.search.search(query);
      this.hits.update((current) => combineHits(page.lists, current));
      this.failures.set(page.failures);
      this.exhausted.set(page.exhausted);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Download (unless given), upload with the SOTA tag and save the metadata of one hit.
   *
   * @param hit - Hit.
   * @param tag - SOTA tag.
   * @param file - PDF picked by the user, or null.
   * @returns Whether it was imported.
   */
  private async importOne(hit: SearchHit, tag: string, file: File | null): Promise<boolean> {
    this.setImport(hit, {
      status: 'running',
      message: file === null ? 'Downloading…' : 'Uploading…',
    });
    try {
      const pdf = file ?? (await this.search.downloadPdf(hit));
      this.setImport(hit, { status: 'running', message: 'Uploading…' });
      const path = await this.transfer.uploadTaggedPdf(pdf, hitFileName(hit.info), tag);
      await this.storage.saveInfo({
        path,
        info: { ...hit.info, source: hit.sources.join(' + '), validated: false },
      });
      this.setImport(hit, { status: 'done', message: 'Imported' });
      this.telemetry.track('research_imports');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setImport(hit, { status: 'failed', message });
      return false;
    }
  }

  /**
   * Record the import state of a hit.
   *
   * @param hit - Hit.
   * @param state - State.
   */
  private setImport(hit: SearchHit, state: HitImport): void {
    this.imports.update((current) => new Map(current).set(hit.key, state));
  }
}

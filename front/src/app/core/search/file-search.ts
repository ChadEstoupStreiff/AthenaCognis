import { inject, Injectable, signal } from '@angular/core';
import type { FileSearchQuery, SearchEvent } from '@domain/search';
import { SearchApi } from './search.api';

/** Progress of a running search. */
export interface SearchProgress {
  readonly current: number;
  readonly total: number;
  readonly file: string;
  readonly semantic: boolean;
}

const PROGRESS_THROTTLE_MS = 120;

/** Stateful streaming search (one per page; cancels the previous run). */
@Injectable()
export class FileSearch {
  private readonly api = inject(SearchApi);
  private abort: AbortController | null = null;
  private lastProgressAt = 0;

  /** Whether a search is running. */
  readonly running = signal(false);
  /** Live progress. */
  readonly progress = signal<SearchProgress | null>(null);
  /** Matching paths, in arrival order. */
  readonly results = signal<readonly string[]>([]);
  /** Last error message. */
  readonly error = signal<string | null>(null);
  /** Duration of the last completed search, in milliseconds. */
  readonly elapsedMs = signal<number | null>(null);
  /** Query of the last run. */
  readonly lastQuery = signal<FileSearchQuery | null>(null);

  /**
   * Run a search, cancelling the previous one.
   *
   * @param query - Search query.
   */
  async run(query: FileSearchQuery): Promise<void> {
    this.cancel();
    const abort = new AbortController();
    this.abort = abort;
    this.reset(query);
    const started = performance.now();
    try {
      for await (const event of this.api.stream(query, abort.signal)) {
        this.apply(event);
      }
      this.elapsedMs.set(performance.now() - started);
    } catch (failure) {
      if (!abort.signal.aborted) {
        this.error.set(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (this.abort === abort) {
        this.running.set(false);
        this.progress.set(null);
      }
    }
  }

  /** Cancel the running search. */
  cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.running.set(false);
  }

  /**
   * Clear state for a new run.
   *
   * @param query - New query.
   */
  private reset(query: FileSearchQuery): void {
    this.lastQuery.set(query);
    this.results.set([]);
    this.error.set(null);
    this.elapsedMs.set(null);
    this.progress.set({ current: 0, total: 0, file: '', semantic: false });
    this.running.set(true);
  }

  /**
   * Apply one stream event.
   *
   * @param event - Search event.
   */
  private apply(event: SearchEvent): void {
    switch (event.type) {
      case 'result':
        this.results.update((paths) =>
          paths.includes(event.path) ? paths : [...paths, event.path],
        );
        return;
      case 'total':
        this.progress.set({ current: 0, total: event.count, file: '', semantic: false });
        return;
      case 'progress':
        this.throttledProgress(event.current, event.total, event.file);
        return;
      case 'semantic_searching':
        this.progress.set({
          current: 0,
          total: event.count,
          file: 'Semantic search…',
          semantic: true,
        });
        return;
      case 'error':
        this.error.set(event.message);
        return;
    }
  }

  /**
   * Update progress at most every 120 ms (the backend emits one event per file).
   *
   * @param current - Files scanned.
   * @param total - Files to scan.
   * @param file - Current file name.
   */
  private throttledProgress(current: number, total: number, file: string): void {
    const now = performance.now();
    if (now - this.lastProgressAt >= PROGRESS_THROTTLE_MS || current === total) {
      this.lastProgressAt = now;
      this.progress.set({ current, total, file, semantic: false });
    }
  }
}

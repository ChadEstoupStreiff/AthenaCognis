import { DestroyRef, inject, Injectable, resource, signal } from '@angular/core';
import type { AiPipelineRequest, OperationInfo } from '@domain/contracts';
import { ApiClient } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';
import { type PipelineReporter as OperationProgress, runAiPipeline } from './ai-pipeline';
import { loadJobsOverview } from './jobs-overview';

const POLL_MS = 15_000;
const ACTIVE_POLL_MS = 4_000;
const MAX_OPERATIONS = 20;

/** Background jobs (polled while the tab is visible) and AI pipelines run by this tab. */
@Injectable({ providedIn: 'root' })
export class JobsStore {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);
  private readonly tick = signal(0);
  private lastPoll = Date.now();
  private nextId = 0;

  /** Job service overview. */
  readonly overview = resource({
    params: () => [this.tick(), this.sync.version('jobs')()] as const,
    loader: () => loadJobsOverview(this.api),
  });

  /** Pipelines started from this tab (they stop if the tab closes). */
  readonly operations = signal<readonly OperationInfo[]>([]);

  /** Start polling. */
  constructor() {
    const timer = setInterval(() => {
      this.pollIfDue();
    }, ACTIVE_POLL_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }

  /**
   * Queue AI operations on files.
   *
   * @param request - Paths and operations.
   * @returns The started operation.
   */
  runPipeline(request: AiPipelineRequest): OperationInfo {
    return this.track('ai-pipeline', `AI on ${String(request.paths.length)} file(s)`, (progress) =>
      runAiPipeline(this.api, request, progress),
    );
  }

  /**
   * Run a long task in the background and show it in the jobs menu.
   *
   * @param kind - Operation kind.
   * @param label - Label.
   * @param task - Work; returns the final message.
   * @returns The started operation.
   */
  track(
    kind: string,
    label: string,
    task: (progress: OperationProgress) => Promise<string | null>,
  ): OperationInfo {
    const operation: OperationInfo = {
      id: String(this.nextId++),
      kind,
      label,
      status: 'running',
      done: 0,
      total: 0,
      message: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.operations.update((list) => [operation, ...list].slice(0, MAX_OPERATIONS));
    void this.execute(operation.id, task);
    return operation;
  }

  /**
   * Run a task and record its progress.
   *
   * @param id - Operation id.
   * @param task - Work.
   */
  private async execute(
    id: string,
    task: (progress: OperationProgress) => Promise<string | null>,
  ): Promise<void> {
    const update = (patch: Partial<OperationInfo>): void => {
      this.operations.update((list) =>
        list.map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)),
      );
    };
    const current = (): OperationInfo | undefined =>
      this.operations().find((operation) => operation.id === id);
    try {
      const message = await task({
        setTotal: (total) => {
          update({ total });
        },
        step: (text) => {
          update({ done: (current()?.done ?? 0) + 1, message: text });
        },
        message: (text) => {
          update({ message: text });
        },
      });
      update({ status: 'succeeded', message, finishedAt: new Date().toISOString() });
    } catch (error) {
      update({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
    }
    this.sync.invalidate('jobs');
  }

  /** Poll when visible: every 4 s while busy, else every 15 s. */
  private pollIfDue(): void {
    if (document.visibilityState !== 'visible') {
      return;
    }
    const busy =
      (this.overview.value()?.activeCount ?? 0) > 0 ||
      this.operations().some((op) => op.status === 'running');
    if (Date.now() - this.lastPoll >= (busy ? ACTIVE_POLL_MS : POLL_MS)) {
      this.lastPoll = Date.now();
      this.tick.update((value) => value + 1);
    }
  }
}

import { DestroyRef, signal } from '@angular/core';

/** Save state shown next to autosaved editors. */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const DEFAULT_DELAY_MS = 1_000;

/**
 * Debounced, serialized, latest-wins autosave.
 *
 * Fixes the Streamlit behaviours where notes re-uploaded on every rerun and TODO edits got lost.
 */
export class AutosaveController<T> {
  /** Current save state. */
  readonly status = signal<SaveStatus>('idle');

  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { readonly value: T } | null = null;
  private running: Promise<void> = Promise.resolve();
  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.pending !== null || this.status() === 'saving') {
      event.preventDefault();
      void this.flush();
    }
  };

  /**
   * Create the controller.
   *
   * @param save - Persists a value.
   * @param destroyRef - Flushes when the owner is destroyed.
   * @param delayMs - Debounce delay.
   */
  constructor(
    private readonly save: (value: T) => Promise<void>,
    destroyRef: DestroyRef,
    private readonly delayMs = DEFAULT_DELAY_MS,
  ) {
    window.addEventListener('beforeunload', this.onBeforeUnload);
    destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', this.onBeforeUnload);
      void this.flush();
    });
  }

  /**
   * Schedule a save of the latest value.
   *
   * @param value - Value to persist.
   */
  schedule(value: T): void {
    this.pending = { value };
    this.status.set('pending');
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
  }

  /**
   * Save the pending value now (waits for any save in flight).
   *
   * @returns Resolves once the pending value is persisted (or failed).
   */
  flush(): Promise<void> {
    this.clearTimer();
    const pending = this.pending;
    if (pending === null) {
      return this.running;
    }
    this.pending = null;
    this.running = this.running.then(() => this.persist(pending.value));
    return this.running;
  }

  /** Drop the pending value without saving. */
  cancel(): void {
    this.clearTimer();
    this.pending = null;
    this.status.set('idle');
  }

  /**
   * Persist one value and update the status.
   *
   * @param value - Value to persist.
   */
  private async persist(value: T): Promise<void> {
    this.status.set('saving');
    try {
      await this.save(value);
      this.status.set(this.pending === null ? 'saved' : 'pending');
    } catch {
      this.pending ??= { value };
      this.status.set('error');
    }
  }

  /** Clear the debounce timer. */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

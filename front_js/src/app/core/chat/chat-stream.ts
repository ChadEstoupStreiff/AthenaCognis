import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { ChatApi } from './chat.api';

const POLL_MS = 400;
/** Polls to wait for a just-sent message to start generating. */
const START_GRACE_POLLS = 8;

/** Live partial answer of a session (the backend exposes it by polling, not streaming). */
@Injectable()
export class ChatStream {
  private readonly chat = inject(ChatApi);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  private grace = 0;

  /** Whether an answer is being generated. */
  readonly running = signal(false);
  /** Partial answer so far. */
  readonly partial = signal('');

  /** Stop polling on destroy. */
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
    });
  }

  /**
   * Follow a session until its generation ends.
   *
   * @param sessionId - Session id.
   * @param onDone - Called once the answer is saved.
   * @param justSent - A message was just sent: wait a little for the generation to start.
   */
  follow(sessionId: string, onDone: () => void, justSent = false): void {
    this.stop();
    this.sessionId = sessionId;
    this.grace = justSent ? START_GRACE_POLLS : 0;
    void this.poll(sessionId, onDone);
  }

  /** Stop following. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.sessionId = null;
    this.running.set(false);
    this.partial.set('');
  }

  /**
   * Poll once and schedule the next poll while running.
   *
   * @param sessionId - Session id.
   * @param onDone - Completion callback.
   */
  private async poll(sessionId: string, onDone: () => void): Promise<void> {
    try {
      const state = await this.chat.runState(sessionId);
      if (this.sessionId !== sessionId) {
        return;
      }
      if (state.state === 'running' || this.grace > 0) {
        this.grace = state.state === 'running' ? 0 : this.grace - 1;
        this.running.set(true);
        this.partial.set(state.answer ?? '');
        this.timer = setTimeout(() => void this.poll(sessionId, onDone), POLL_MS);
        return;
      }
    } catch {
      // Backend restarted: treat as finished.
    }
    const wasRunning = this.running();
    this.stop();
    if (wasRunning) {
      onDone();
    }
  }
}

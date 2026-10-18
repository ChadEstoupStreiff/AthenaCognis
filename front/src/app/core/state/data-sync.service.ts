import { Injectable, type Signal, signal, type WritableSignal } from '@angular/core';

/** Data domains whose views refetch together after a write. */
export type SyncTopic =
  | 'files'
  | 'projects'
  | 'tags'
  | 'contacts'
  | 'calendar'
  | 'tasks'
  | 'kanban'
  | 'chat'
  | 'settings'
  | 'pinned'
  | 'notes'
  | 'links'
  | 'jobs'
  | 'sota'
  | 'ollama';

/** Version counters per topic: resources read them, writes bump them. */
@Injectable({ providedIn: 'root' })
export class DataSync {
  private readonly versions = new Map<SyncTopic, WritableSignal<number>>();

  /**
   * Version signal of a topic (read it inside resource params to refetch on change).
   *
   * @param topic - Topic.
   * @returns The version signal.
   */
  version(topic: SyncTopic): Signal<number> {
    return this.counter(topic).asReadonly();
  }

  /**
   * Mark topics as changed.
   *
   * @param topics - Changed topics.
   */
  invalidate(...topics: SyncTopic[]): void {
    for (const topic of topics) {
      this.counter(topic).update((value) => value + 1);
    }
  }

  /**
   * Get or create the counter of a topic.
   *
   * @param topic - Topic.
   * @returns The writable counter.
   */
  private counter(topic: SyncTopic): WritableSignal<number> {
    let value = this.versions.get(topic);
    if (value === undefined) {
      value = signal(0);
      this.versions.set(topic, value);
    }
    return value;
  }
}

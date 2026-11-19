import { linkedSignal, type Signal } from '@angular/core';

/** Part of an Angular resource read by {@link latestValue}. */
export interface ValueSource<T> {
  hasValue(): boolean;
  readonly value: Signal<T | undefined>;
}

/**
 * Last loaded value of a resource, kept while it reloads or fails.
 *
 * A resource whose params change (e.g. a DataSync version bump after a write) drops its value
 * until the new one arrives; reading it directly makes lists flash empty.
 *
 * @param source - Resource.
 * @param fallback - Value before the first load.
 * @returns Stable value signal.
 */
export function latestValue<T>(source: ValueSource<T>, fallback: T): Signal<T> {
  return linkedSignal<T | undefined, T>({
    source: () => (source.hasValue() ? source.value() : undefined),
    computation: (value, previous) => value ?? previous?.value ?? fallback,
  });
}

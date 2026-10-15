import { effect, signal, type WritableSignal } from '@angular/core';

/**
 * Stored panel width, or the fallback when missing or unreadable.
 *
 * @param key - Storage key.
 * @param fallback - Default width.
 * @returns Width in pixels.
 */
function readWidth(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key));
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
  } catch {
    // Storage unavailable: use the default width.
  }
  return fallback;
}

/**
 * Panel width signal remembered across visits (call in an injection context).
 *
 * @param key - Storage key.
 * @param fallback - Default width.
 * @returns Writable width signal saved on every change.
 */
export function persistedWidth(key: string, fallback: number): WritableSignal<number> {
  const width = signal(readWidth(key, fallback));
  effect(() => {
    const value = width();
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Storage unavailable (private mode): the width lasts for this page only.
    }
  });
  return width;
}

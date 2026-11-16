import type { JobTask } from '@domain/contracts';

const MESSAGE_KEYS = ['message', 'detail', 'error_description'] as const;
const JSON_START = /[[{]/;

/**
 * Human message of a parsed JSON error body (nested `error` objects included).
 *
 * @param value - Parsed body or part of it.
 * @returns Message, or null when absent.
 */
export function messageOf(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (Array.isArray(value)) {
    return value.map(messageOf).find((message) => message !== null) ?? null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of MESSAGE_KEYS) {
    const text = record[key];
    if (typeof text === 'string' && text.trim() !== '') {
      return text.trim();
    }
  }
  return messageOf(record['error']);
}

/**
 * Parse JSON text.
 *
 * @param text - Text.
 * @returns Value, or undefined when invalid.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Readable reason of a failed task (raw provider JSON reduced to its message).
 *
 * @param task - Task.
 * @returns Reason, or null when the task did not fail.
 */
export function jobFailure(task: Pick<JobTask, 'state' | 'result'>): string | null {
  if (task.state !== 'FAILED') {
    return null;
  }
  const result = (task.result ?? '').trim();
  if (result === '') {
    return 'Failed without a reason.';
  }
  const start = result.search(JSON_START);
  const message = start < 0 ? null : messageOf(parseJson(result.slice(start)));
  return message === null ? result : `${result.slice(0, start).trim()} ${message}`.trim();
}

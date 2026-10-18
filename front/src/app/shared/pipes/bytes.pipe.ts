import { Pipe, type PipeTransform } from '@angular/core';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const STEP = 1024;
const DECIMALS = 1;

/**
 * Format a byte count (`1536` → `1.5 KB`).
 *
 * @param bytes - Byte count.
 * @returns Human-readable size.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '—';
  }
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(DECIMALS)} ${UNITS[unit] ?? 'B'}`;
}

/** Template pipe for {@link formatBytes}. */
@Pipe({ name: 'bytes' })
export class BytesPipe implements PipeTransform {
  /**
   * Format bytes.
   *
   * @param bytes - Byte count.
   * @returns Human-readable size.
   */
  transform(bytes: number | null | undefined): string {
    return formatBytes(bytes);
  }
}

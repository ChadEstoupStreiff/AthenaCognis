import type { GenerationOutput, GenerationSpan, SettingValue } from '@domain/contracts';
import { DEFAULT_PERIOD_OPTIONS, type PeriodOptions } from './activity-period';

/** Context of a weekly or monthly generation. */
export type GenerationBasis = 'generated' | 'sources';

/** Defaults of a generation: from its schedule settings. */
export interface ScheduleDefaults {
  readonly basis: GenerationBasis;
  /** Data source keys; empty = every enabled source. */
  readonly sources: readonly string[];
  readonly outputs: readonly GenerationOutput[];
}

/** Settings shared by every span. */
export const TIMEZONE_SETTING = 'activity_generation_timezone';
export const DAY_START_SETTING = 'activity_generation_day_start';
export const WEEK_START_SETTING = 'activity_generation_week_start';

const MINUTES_PER_HOUR = 60;
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const WEEK_DAYS = 7;
const BOTH_OUTPUTS: readonly GenerationOutput[] = ['summary', 'time'];
const OUTPUT_VALUES: ReadonlySet<string> = new Set(BOTH_OUTPUTS);

/**
 * Setting key of a schedule field.
 *
 * @param span - Time span.
 * @param name - Field name (e.g. `enabled`).
 * @returns `activity_generation_<span>_<name>`.
 */
export function spanSetting(span: GenerationSpan, name: string): string {
  return `activity_generation_${span}_${name}`;
}

/**
 * Minutes after midnight of an `HH:MM` value.
 *
 * @param value - Stored value.
 * @returns Minutes, 0 when malformed.
 */
export function clockMinutes(value: SettingValue | undefined): number {
  const match = typeof value === 'string' ? CLOCK_PATTERN.exec(value) : null;
  const hours = Number(match?.[1] ?? 0);
  const minutes = Number(match?.[2] ?? 0);
  if (hours > MAX_HOUR || minutes > MAX_MINUTE) {
    return 0;
  }
  return hours * MINUTES_PER_HOUR + minutes;
}

/**
 * When days and weeks start.
 *
 * @param values - Every setting.
 * @returns Period options, defaults when unset.
 */
export function periodOptions(values: Readonly<Record<string, SettingValue>>): PeriodOptions {
  const weekStart = values[WEEK_START_SETTING];
  return {
    dayStartMinutes: clockMinutes(values[DAY_START_SETTING]),
    weekStart:
      typeof weekStart === 'number' && weekStart >= 1 && weekStart <= WEEK_DAYS
        ? weekStart
        : DEFAULT_PERIOD_OPTIONS.weekStart,
  };
}

/**
 * Strings of a stored list.
 *
 * @param value - Stored value.
 * @returns Strings, null when not a list.
 */
function strings(value: SettingValue | undefined): string[] | null {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : null;
}

/**
 * Defaults of a generation form, from the schedule of its span.
 *
 * @param values - Every setting.
 * @param span - Time span.
 * @returns Basis, sources and outputs (both outputs when unset).
 */
export function scheduleDefaults(
  values: Readonly<Record<string, SettingValue>>,
  span: GenerationSpan,
): ScheduleDefaults {
  const outputs = strings(values[spanSetting(span, 'outputs')]);
  return {
    basis: values[spanSetting(span, 'basis')] === 'sources' ? 'sources' : 'generated',
    sources: strings(values[spanSetting(span, 'sources')]) ?? [],
    outputs:
      outputs === null
        ? BOTH_OUTPUTS
        : outputs.filter((item): item is GenerationOutput => OUTPUT_VALUES.has(item)),
  };
}

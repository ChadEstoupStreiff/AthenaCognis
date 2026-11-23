import type { GenerationOutput, GenerationSpan, SettingValue } from '@domain/contracts';
import { DEFAULT_PERIOD_OPTIONS, type PeriodOptions } from './activity-period';

/**
 * Context of a weekly or monthly generation: summaries of the next shorter span
 * (`generated`), daily summaries (`generated_daily`, monthly only) or data sources.
 */
export type GenerationBasis = 'generated' | 'generated_daily' | 'sources';

/** Context choice of a form. */
export interface ContextOption {
  readonly value: GenerationBasis;
  readonly label: string;
}

/** Defaults of a generation: from its schedule settings. */
export interface ScheduleDefaults {
  readonly basis: GenerationBasis;
  /** Monthly from weekly: fill days no weekly summary covers with daily summaries. */
  readonly fillWithDaily: boolean;
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
const SOURCES_OPTION: ContextOption = { value: 'sources', label: 'Select data sources' };
/** Context choices per span; none for daily (always data sources). */
const CONTEXT_OPTIONS: Readonly<Record<GenerationSpan, readonly ContextOption[]>> = {
  daily: [],
  weekly: [{ value: 'generated', label: 'Use generated daily' }, SOURCES_OPTION],
  monthly: [
    { value: 'generated', label: 'Use generated weekly' },
    { value: 'generated_daily', label: 'Use generated daily' },
    SOURCES_OPTION,
  ],
};
/** Weekdays the daily schedule can generate (stored codes, Monday first). */
export const DAILY_WEEKDAY_OPTIONS: readonly { readonly value: string; readonly label: string }[] =
  [
    { value: 'mon', label: 'Monday' },
    { value: 'tue', label: 'Tuesday' },
    { value: 'wed', label: 'Wednesday' },
    { value: 'thu', label: 'Thursday' },
    { value: 'fri', label: 'Friday' },
    { value: 'sat', label: 'Saturday' },
    { value: 'sun', label: 'Sunday' },
  ];
/** Label of the monthly fill toggle. */
export const FILL_WITH_DAILY_LABEL = 'Use daily to fill non generated day with weekly';

/**
 * Context choices of a span.
 *
 * @param span - Time span.
 * @returns Choices; empty for daily.
 */
export function contextOptions(span: GenerationSpan): readonly ContextOption[] {
  return CONTEXT_OPTIONS[span];
}

/**
 * Whether a span offers the fill-with-daily toggle for a context.
 *
 * @param span - Time span.
 * @param basis - Context.
 * @returns True for monthly built from weekly summaries.
 */
export function offersFillWithDaily(span: GenerationSpan, basis: GenerationBasis): boolean {
  return span === 'monthly' && basis === 'generated';
}

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
 * Context stored for a span.
 *
 * @param value - Stored value.
 * @param span - Time span.
 * @returns Stored context when offered by the span, `generated` otherwise.
 */
export function storedBasis(
  value: SettingValue | undefined,
  span: GenerationSpan,
): GenerationBasis {
  const offered = contextOptions(span).find((option) => option.value === value);
  return offered?.value ?? 'generated';
}

/**
 * Defaults of a generation form, from the schedule of its span.
 *
 * @param values - Every setting.
 * @param span - Time span.
 * @returns Basis, fill toggle, sources and outputs (both outputs when unset).
 */
export function scheduleDefaults(
  values: Readonly<Record<string, SettingValue>>,
  span: GenerationSpan,
): ScheduleDefaults {
  const outputs = strings(values[spanSetting(span, 'outputs')]);
  return {
    basis: storedBasis(values[spanSetting(span, 'basis')], span),
    fillWithDaily: values[spanSetting(span, 'fill_daily')] === true,
    sources: strings(values[spanSetting(span, 'sources')]) ?? [],
    outputs:
      outputs === null
        ? BOTH_OUTPUTS
        : outputs.filter((item): item is GenerationOutput => OUTPUT_VALUES.has(item)),
  };
}

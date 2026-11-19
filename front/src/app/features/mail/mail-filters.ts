import type { MailCategory } from '@domain/contracts';

/** Tri-state filter: any, only true, only false. */
export type TriState = 'any' | 'yes' | 'no';

/** Search filters of the mail list. */
export interface MailFilters {
  readonly fromText: string;
  readonly toText: string;
  /** First day included (`YYYY-MM-DD`), empty = none. */
  readonly since: string;
  /** Last day included (`YYYY-MM-DD`), empty = none. */
  readonly until: string;
  readonly category: MailCategory | null;
  readonly unread: TriState;
  readonly attachments: TriState;
}

/** No filter. */
export const EMPTY_FILTERS: MailFilters = {
  fromText: '',
  toText: '',
  since: '',
  until: '',
  category: null,
  unread: 'any',
  attachments: 'any',
};

/** Query parameter value of a tri-state filter. */
const TRI_STATE_PARAM: Readonly<Record<TriState, boolean | null>> = {
  any: null,
  yes: true,
  no: false,
};

/**
 * Text value, or null when blank.
 *
 * @param value - Text.
 * @returns Trimmed text or null.
 */
function textParam(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/**
 * Query parameters of the filters (unset filters are null, so they are dropped;
 * a reversed date range is ignored until fixed).
 *
 * @param filters - Filters.
 * @returns `/mail/messages` parameters.
 */
export function filterParams(filters: MailFilters): Record<string, string | boolean | null> {
  const datesUsable = !reversedDates(filters);
  return {
    from_text: textParam(filters.fromText),
    to_text: textParam(filters.toText),
    since: datesUsable ? textParam(filters.since) : null,
    until: datesUsable ? textParam(filters.until) : null,
    category: filters.category,
    unread: TRI_STATE_PARAM[filters.unread],
    attachments: TRI_STATE_PARAM[filters.attachments],
  };
}

/**
 * Number of active filters (shown on the Filters button).
 *
 * @param filters - Filters.
 * @returns Count.
 */
export function activeFilterCount(filters: MailFilters): number {
  return Object.values(filterParams(filters)).filter((value) => value !== null).length;
}

/**
 * Whether the date range is reversed.
 *
 * @param filters - Filters.
 * @returns True when "since" is after "until".
 */
export function reversedDates(filters: MailFilters): boolean {
  return filters.since !== '' && filters.until !== '' && filters.since > filters.until;
}

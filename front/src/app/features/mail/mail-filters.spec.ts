import { activeFilterCount, EMPTY_FILTERS, filterParams, reversedDates } from './mail-filters';

describe('mail filters', () => {
  it('drops unset filters and maps tri-states to booleans', () => {
    const filters = {
      ...EMPTY_FILTERS,
      fromText: ' ann ',
      unread: 'yes',
      attachments: 'no',
    } as const;
    expect(filterParams(filters)).toEqual({
      from_text: 'ann',
      to_text: null,
      since: null,
      until: null,
      category: null,
      unread: true,
      attachments: false,
    });
    expect(activeFilterCount(filters)).toBe(3);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('detects a reversed date range', () => {
    expect(reversedDates({ ...EMPTY_FILTERS, since: '2026-11-18', until: '2026-11-17' })).toBe(
      true,
    );
    expect(reversedDates({ ...EMPTY_FILTERS, since: '2026-11-17', until: '2026-11-17' })).toBe(
      false,
    );
    expect(reversedDates({ ...EMPTY_FILTERS, since: '2026-11-18' })).toBe(false);
    const reversed = { ...EMPTY_FILTERS, since: '2026-11-18', until: '2026-11-17' };
    expect(filterParams(reversed)['since']).toBeNull();
    expect(activeFilterCount(reversed)).toBe(0);
  });
});

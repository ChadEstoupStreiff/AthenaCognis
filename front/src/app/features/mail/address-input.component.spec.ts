import type { MailAddressSuggestion } from '@domain/contracts';
import { freshSuggestions, shouldCommit } from './address-input.component';

/**
 * Build a suggestion.
 *
 * @param email - Address.
 * @returns Suggestion.
 */
function suggestion(email: string): MailAddressSuggestion {
  return { email, name: '', count: 1, last_date: '2026-11-19T10:00:00' };
}

describe('address input', () => {
  it('hides suggestions already in the recipient list', () => {
    const found = [suggestion('ann@x.org'), suggestion('bob@y.org')];
    expect(freshSuggestions(found, ['Ann@x.org']).map((row) => row.email)).toEqual(['bob@y.org']);
  });

  it('turns text into pills after a separator or a space following an address', () => {
    expect(shouldCommit('a@x.org,')).toBe(true);
    expect(shouldCommit('a@x.org ')).toBe(true);
    expect(shouldCommit('jean ')).toBe(false);
    expect(shouldCommit('a@x.org')).toBe(false);
  });
});

import type { UpdateStatus } from '@domain/contracts';
import { formatVersion, isUpdateAvailable } from './update-check';

const BASE: UpdateStatus = {
  state: 'up_to_date',
  behind_by: 0,
  local_commit: 'a'.repeat(40),
  local_branch: 'main',
  reason: '',
  checked_at: 0,
};

describe('isUpdateAvailable', () => {
  it('is true only when GitHub has newer commits', () => {
    expect(isUpdateAvailable(null)).toBe(false);
    expect(isUpdateAvailable(BASE)).toBe(false);
    expect(isUpdateAvailable({ ...BASE, state: 'unknown', reason: 'offline' })).toBe(false);
    expect(isUpdateAvailable({ ...BASE, state: 'behind', behind_by: 2 })).toBe(true);
    expect(isUpdateAvailable({ ...BASE, state: 'diverged', behind_by: 1 })).toBe(true);
  });
});

describe('formatVersion', () => {
  it('joins branch and short commit, empty when the commit is unknown', () => {
    expect(formatVersion(null)).toBe('');
    expect(formatVersion({ ...BASE, local_commit: '1234567890abcdef', local_branch: 'dev' })).toBe(
      'dev-1234567',
    );
    expect(formatVersion({ ...BASE, state: 'unknown', local_commit: '', local_branch: '' })).toBe(
      '',
    );
  });
});

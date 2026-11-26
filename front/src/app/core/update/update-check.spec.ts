import type { UpdateStatus } from '@domain/contracts';
import { isUpdateAvailable } from './update-check';

const BASE: UpdateStatus = {
  state: 'up_to_date',
  behind_by: 0,
  local_commit: 'a'.repeat(40),
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

import type { MailOutboxItem, OutboxState } from '@domain/contracts';
import { bodyPreview } from './outbox-panel.component';
import { hasPending, someLeft } from './outbox.store';

/**
 * Build an Outbox message.
 *
 * @param id - Id.
 * @param state - State.
 * @returns Message.
 */
function item(id: string, state: OutboxState): MailOutboxItem {
  return {
    id,
    account_id: 'acc',
    to: ['a@x.org'],
    cc: [],
    bcc: [],
    subject: 'Hi',
    body: 'Hello',
    created: '2026-11-19T10:00:00',
    state,
    error: null,
    attempts: 0,
  };
}

describe('outbox', () => {
  it('polls only while messages wait for the sender', () => {
    expect(hasPending([item('1', 'failed')])).toBe(false);
    expect(hasPending([item('1', 'failed'), item('2', 'queued')])).toBe(true);
    expect(hasPending([item('1', 'sending')])).toBe(true);
    expect(hasPending([])).toBe(false);
  });

  it('notices messages that left the Outbox', () => {
    expect(someLeft(new Set(['1', '2']), [item('2', 'queued')])).toBe(true);
    expect(someLeft(new Set(['1']), [item('1', 'queued'), item('3', 'queued')])).toBe(false);
    expect(someLeft(new Set(), [])).toBe(false);
  });

  it('previews bodies on one short line', () => {
    expect(bodyPreview('Hello\n\n  world')).toBe('Hello world');
    expect(bodyPreview('x'.repeat(200))).toHaveLength(141);
  });
});

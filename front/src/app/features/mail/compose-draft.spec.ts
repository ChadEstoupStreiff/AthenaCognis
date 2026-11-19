import type { MailDraft } from '@domain/contracts';
import {
  type ComposeForm,
  draftInput,
  formOfDraft,
  hasContent,
  sameForm,
  SaveQueue,
} from './compose-draft';

const EMPTY: ComposeForm = { accountId: 'acc', to: '', cc: '', subject: '', body: '' };

describe('compose drafts', () => {
  it('keeps a draft only when something was typed', () => {
    expect(hasContent(EMPTY)).toBe(false);
    expect(hasContent({ ...EMPTY, body: '   ' })).toBe(false);
    expect(hasContent({ ...EMPTY, subject: 'Plan' })).toBe(true);
    expect(hasContent({ ...EMPTY, to: 'a@x.org' })).toBe(true);
  });

  it('compares every form field', () => {
    expect(sameForm(EMPTY, { ...EMPTY })).toBe(true);
    expect(sameForm(EMPTY, { ...EMPTY, accountId: 'other' })).toBe(false);
    expect(sameForm(EMPTY, { ...EMPTY, body: 'x' })).toBe(false);
  });

  it('round-trips a form through a saved draft', () => {
    const form: ComposeForm = {
      accountId: 'acc',
      to: 'a@x.org, b@x.org',
      cc: 'c@x.org',
      subject: 'Re: Plan',
      body: 'Ok',
    };
    const input = draftInput(form, { kind: 'reply', quote: '> q', replyToId: 'm1' });
    expect(input).toEqual({
      account_id: 'acc',
      kind: 'reply',
      to: ['a@x.org', 'b@x.org'],
      cc: ['c@x.org'],
      subject: 'Re: Plan',
      body: 'Ok',
      quote: '> q',
      reply_to_id: 'm1',
    });
    const saved: MailDraft = {
      ...input,
      id: 'd1',
      updated: '2026-11-19T10:00:00',
      trashed_at: null,
    };
    expect(formOfDraft(saved)).toEqual(form);
  });

  it('runs saves one after the other, even after a failure', async () => {
    const queue = new SaveQueue();
    const order: string[] = [];
    let release = (): void => undefined;
    const first = queue.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => {
            order.push('first');
            resolve('first');
          };
        }),
    );
    const failing = queue.run(() => Promise.reject(new Error('boom')));
    const third = queue.run(() => {
      order.push('third');
      return Promise.resolve('third');
    });
    const failed = expect(failing).rejects.toThrow('boom');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    release();
    await expect(first).resolves.toBe('first');
    await failed;
    await expect(third).resolves.toBe('third');
    await queue.idle();
    expect(order).toEqual(['first', 'third']);
  });
});

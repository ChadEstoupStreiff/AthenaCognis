import type { MailDetail } from '@domain/contracts';
import {
  activityDayStart,
  isActivityToday,
  forwardBody,
  forwardSubject,
  parseAddressList,
  listName,
  isHtmlSignature,
  commitDraft,
  contactNames,
  formatEmailName,
  joinRecipients,
  recipientLabel,
  mailTime,
  quoteBody,
  replySubject,
  senderLabel,
  splitAddresses,
  trashDaysLeft,
  utcDate,
} from './mail-model';

describe('mail model', () => {
  it('splits recipient lists and drops non-addresses', () => {
    expect(splitAddresses('a@x.org, b@x.org; c@x.org  nope')).toEqual([
      'a@x.org',
      'b@x.org',
      'c@x.org',
    ]);
    expect(splitAddresses('  ')).toEqual([]);
  });

  it('prefixes reply subjects once', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
  });

  it('falls back to the address when the sender has no name', () => {
    expect(senderLabel({ sender_name: '', sender_email: 'a@x.org' })).toBe('a@x.org');
    expect(senderLabel({ sender_name: 'Alice', sender_email: 'a@x.org' })).toBe('Alice');
  });

  it('quotes every line of the original', () => {
    const mail = {
      date: '2026-11-17T09:00:00',
      sender_name: 'Alice',
      sender_email: 'a@x.org',
      body_text: 'one\ntwo',
    } as MailDetail;
    const quoted = quoteBody(mail);
    expect(quoted.startsWith('On ')).toBe(true);
    expect(quoted.endsWith('Alice wrote:\n> one\n> two')).toBe(true);
  });

  it('shows the time for today and a date otherwise', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(mailTime('2026-11-17T11:00:00', now)).toMatch(/\d{1,2}:\d{2}/);
    expect(mailTime('2025-01-02T11:00:00', now)).toContain('2025');
  });

  it('detects HTML signatures', () => {
    expect(isHtmlSignature('<p>Chad</p>')).toBe(true);
    expect(isHtmlSignature('Chad <chad@x.org>')).toBe(false);
    expect(isHtmlSignature('Chad<br/>PhD')).toBe(true);
    expect(isHtmlSignature('Chad\nPhD, a < b')).toBe(false);
  });

  it('labels recipients with their People name, else a name from the address', () => {
    expect(formatEmailName('jean.dupont-moreau@x.org')).toBe('Jean Dupont Moreau');
    expect(recipientLabel('jd@x.org', 'Jean Dupont')).toBe('Jean Dupont <jd@x.org>');
    expect(recipientLabel('jean.dupont@x.org', '')).toBe('Jean Dupont <jean.dupont@x.org>');
  });

  it('maps contact addresses to names', () => {
    const names = contactNames([
      { name: 'Ann', email: 'Ann@x.org; ann@home.org' },
      { name: 'Bob', email: null },
    ]);
    expect(names.get('ann@x.org')).toBe('Ann');
    expect(names.get('ann@home.org')).toBe('Ann');
    expect(names.size).toBe(2);
  });

  it('moves typed addresses into the recipients, keeping the rest', () => {
    expect(commitDraft(['a@x.org'], 'b@x.org, A@x.org jo')).toEqual({
      recipients: ['a@x.org', 'b@x.org'],
      rest: 'jo',
    });
    expect(joinRecipients(['a@x.org', 'b@x.org'])).toBe('a@x.org, b@x.org');
  });

  it('names sent mail by its recipients', () => {
    const base = { sender_name: 'Me', sender_email: 'me@x.org', recipients: 'Ann <a@x.org>' };
    expect(listName({ ...base, mailbox: 'sent' })).toBe('To: Ann <a@x.org>');
    expect(listName({ ...base, mailbox: 'inbox' })).toBe('Me');
  });

  it('parses address headers, commas inside quotes included', () => {
    expect(parseAddressList('"Doe, Ann" <a@x.org>, b@x.org,Bob <c@x.org>')).toEqual([
      { name: 'Doe, Ann', email: 'a@x.org' },
      { name: '', email: 'b@x.org' },
      { name: 'Bob', email: 'c@x.org' },
    ]);
    expect(parseAddressList('')).toEqual([]);
  });

  it('prefixes forward subjects once', () => {
    expect(forwardSubject('Hello')).toBe('Fwd: Hello');
    expect(forwardSubject('FW: Hello')).toBe('FW: Hello');
    expect(forwardSubject('TR: Bonjour')).toBe('TR: Bonjour');
  });

  it('writes the forwarded headers above the original text', () => {
    const mail = {
      date: '2026-11-17T09:00:00',
      sender_name: 'Ann',
      sender_email: 'a@x.org',
      subject: 'Plan',
      recipients: 'me@x.org',
      cc: '',
      body_text: 'Original',
    } as MailDetail;
    const block = forwardBody(mail);
    expect(block.startsWith('---------- Forwarded message ----------\nFrom: Ann <a@x.org>')).toBe(
      true,
    );
    expect(block).toContain('Subject: Plan\nTo: me@x.org\n\nOriginal');
    expect(block).not.toContain('Cc:');
  });

  it('reads backend dates as UTC', () => {
    expect(utcDate('2026-11-17T09:00:00').toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });

  it('starts the activity day at the reset time, the day before when earlier', () => {
    const afternoon = new Date(2026, 10, 19, 15, 0);
    const night = new Date(2026, 10, 19, 3, 0);
    expect(activityDayStart('04:00', afternoon)).toEqual(new Date(2026, 10, 19, 4, 0));
    expect(activityDayStart('04:00', night)).toEqual(new Date(2026, 10, 18, 4, 0));
    expect(activityDayStart('bogus', night)).toEqual(new Date(2026, 10, 18, 4, 0));
  });

  it('keeps an activity flag until the next reset time', () => {
    const flaggedAtThree = { activity_flagged_at: new Date(2026, 10, 19, 3, 0).toISOString() };
    expect(isActivityToday(flaggedAtThree, '04:00', new Date(2026, 10, 19, 3, 30))).toBe(true);
    expect(isActivityToday(flaggedAtThree, '04:00', new Date(2026, 10, 19, 4, 30))).toBe(false);
    expect(isActivityToday({ activity_flagged_at: null }, '04:00')).toBe(false);
  });
});

describe('trashDaysLeft', () => {
  const now = new Date('2026-11-19T12:00:00Z');

  it('counts whole days until the purge, rounded up', () => {
    expect(trashDaysLeft('2026-11-19T11:00:00', 30, now)).toBe(30);
    expect(trashDaysLeft('2026-11-10T12:00:00', 30, now)).toBe(21);
  });

  it('never goes below zero once the retention is over', () => {
    expect(trashDaysLeft('2026-10-01T00:00:00', 30, now)).toBe(0);
  });
});

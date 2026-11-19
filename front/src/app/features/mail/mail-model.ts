import type { MailDetail, MailSummary, MailView, SenderFlag } from '@domain/contracts';

/** Label and icon of a mailbox view. */
export interface ViewMeta {
  readonly view: MailView;
  readonly label: string;
  readonly icon: string;
  readonly hint: string;
}

/** Default view: VIP senders and contacts. */
export const PRIORITY_VIEW: ViewMeta = {
  view: 'priority',
  label: 'Priority',
  icon: 'pi pi-star',
  hint: 'VIP senders and people from your contacts',
};

/** Sidebar views, in display order. */
export const VIEW_META: readonly ViewMeta[] = [
  PRIORITY_VIEW,
  { view: 'pinned', label: 'Pinned', icon: 'pi pi-thumbtack', hint: 'Mail you pinned' },
  { view: 'inbox', label: 'People', icon: 'pi pi-inbox', hint: 'Mail written by people' },
  { view: 'unread', label: 'Unread', icon: 'pi pi-circle-fill', hint: 'Everything unread' },
  {
    view: 'needs_reply',
    label: 'To answer',
    icon: 'pi pi-reply',
    hint: 'AI found the sender expects an answer',
  },
  { view: 'flagged', label: 'Flagged', icon: 'pi pi-flag', hint: 'Flagged on the server' },
  {
    view: 'others',
    label: 'Low priority',
    icon: 'pi pi-megaphone',
    hint: 'Newsletters, notifications, muted senders',
  },
  {
    view: 'all',
    label: 'All mail',
    icon: 'pi pi-envelope',
    hint: 'Everything received but blocked',
  },
  { view: 'sent', label: 'Sent', icon: 'pi pi-send', hint: 'Mail you sent' },
  { view: 'blocked', label: 'Blocked', icon: 'pi pi-ban', hint: 'Blocked senders' },
];

/** Label, icon and hint of a sender flag. */
export interface FlagMeta {
  readonly flag: SenderFlag;
  readonly label: string;
  readonly icon: string;
  readonly hint: string;
}

/** Sender flags, in display order. */
export const FLAG_META: readonly FlagMeta[] = [
  { flag: 'vip', label: 'VIP', icon: 'pi pi-star-fill', hint: 'Always in Priority' },
  { flag: 'normal', label: 'Normal', icon: 'pi pi-user', hint: 'Default treatment' },
  { flag: 'muted', label: 'Muted', icon: 'pi pi-volume-off', hint: 'Arrives read, low priority' },
  { flag: 'blocked', label: 'Blocked', icon: 'pi pi-ban', hint: 'Hidden from every view' },
];

const REPLY_PREFIX = /^re:/i;
const RESET_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_RESET_HOURS = 4;
const FORWARD_PREFIX = /^(fwd?|tr):/i;
const ADDRESS_SEPARATOR = /[,;\s]+/;
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const QUOTE_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
};

/**
 * Split a typed recipient list.
 *
 * @param value - Addresses separated by commas, semicolons or spaces.
 * @returns Addresses containing `@`.
 */
export function splitAddresses(value: string): string[] {
  return value
    .split(ADDRESS_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.includes('@'));
}

/**
 * Prefix a subject with "Re:" once.
 *
 * @param subject - Original subject.
 * @returns Reply subject.
 */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return REPLY_PREFIX.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * Display name of a sender.
 *
 * @param mail - Message.
 * @returns Name, or the address when unnamed.
 */
export function senderLabel(mail: Pick<MailSummary, 'sender_name' | 'sender_email'>): string {
  return mail.sender_name.trim() === '' ? mail.sender_email : mail.sender_name;
}

/**
 * Quote the original message below a reply.
 *
 * @param mail - Replied message.
 * @returns Quoted text.
 */
export function quoteBody(mail: MailDetail): string {
  const date = utcDate(mail.date).toLocaleString(undefined, QUOTE_DATE_OPTIONS);
  const quoted = mail.body_text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `On ${date}, ${senderLabel(mail)} wrote:\n${quoted}`;
}

/**
 * Parse a backend date (naive UTC).
 *
 * @param value - ISO date without zone.
 * @returns Date.
 */
export function utcDate(value: string): Date {
  return new Date(value.endsWith('Z') ? value : `${value}Z`);
}

/**
 * Start of the current activity day: today at the reset time, or yesterday before it.
 *
 * @param resetTime - Activity reset time, `HH:MM` (invalid: 04:00).
 * @param now - Reference time.
 * @returns Local moment the activity day began.
 */
export function activityDayStart(resetTime: string, now: Date = new Date()): Date {
  const match = RESET_TIME.exec(resetTime);
  const hours = match ? Number(match[1]) : DEFAULT_RESET_HOURS;
  const minutes = match ? Number(match[2]) : 0;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  if (start > now) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

/**
 * Whether a message is flagged for the current activity day (flags reset daily).
 *
 * @param mail - Message.
 * @param resetTime - Activity reset time, `HH:MM`.
 * @param now - Reference time.
 * @returns True when flagged since the last reset.
 */
export function isActivityToday(
  mail: Pick<MailSummary, 'activity_flagged_at'>,
  resetTime: string,
  now: Date = new Date(),
): boolean {
  const flaggedAt = mail.activity_flagged_at;
  return flaggedAt !== null && utcDate(flaggedAt) >= activityDayStart(resetTime, now);
}

/**
 * Short list date: time today, day and month this year, full date otherwise.
 *
 * @param value - Backend date (naive UTC).
 * @param now - Reference time.
 * @returns Label.
 */
export function mailTime(value: string, now: Date = new Date()): string {
  const date = utcDate(value);
  if (date.toDateString() === now.toDateString()) {
    return TIME_FORMAT.format(date);
  }
  return date.getFullYear() === now.getFullYear()
    ? DAY_FORMAT.format(date)
    : YEAR_FORMAT.format(date);
}

const DAY_MS = 86_400_000;

/**
 * Whole days before a Trash item is removed for good.
 *
 * @param trashedAt - Deletion time, naive UTC.
 * @param retentionDays - Days items stay in the Trash.
 * @param now - Reference time.
 * @returns Days left, 0 when due at the next purge.
 */
export function trashDaysLeft(
  trashedAt: string,
  retentionDays: number,
  now: Date = new Date(),
): number {
  const purgeAt = utcDate(trashedAt).getTime() + retentionDays * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - now.getTime()) / DAY_MS));
}

const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i;
/**
 * Tell whether a signature is written in HTML.
 *
 * @param signature - Account signature.
 * @returns True when it holds an HTML tag.
 */
export function isHtmlSignature(signature: string): boolean {
  return HTML_TAG.test(signature);
}

const RECIPIENT_JOINER = ', ';
const NAME_PART_SEPARATOR = /[._+-]+/;

/**
 * Readable name guessed from an address ("jean.dupont@x.org" → "Jean Dupont").
 *
 * @param email - Address.
 * @returns Capitalized words of the local part.
 */
export function formatEmailName(email: string): string {
  return (email.split('@')[0] ?? '')
    .split(NAME_PART_SEPARATOR)
    .filter((part) => part !== '')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

/**
 * Pill text of a recipient: People name (else a name guessed from the address) and address.
 *
 * @param email - Address.
 * @param contactName - Name of the matching People contact, empty when none.
 * @returns "Name <email>".
 */
export function recipientLabel(email: string, contactName: string): string {
  const name = contactName.trim() || formatEmailName(email);
  return name === '' ? email : `${name} <${email}>`;
}

/**
 * People contact names by lowercase address.
 *
 * @param contacts - Contacts (their email field may hold several addresses).
 * @returns Map address → name.
 */
export function contactNames(
  contacts: readonly { readonly name: string; readonly email: string | null }[],
): Map<string, string> {
  return new Map(
    contacts.flatMap((contact) =>
      splitAddresses(contact.email ?? '').map((email): [string, string] => [
        email.toLowerCase(),
        contact.name,
      ]),
    ),
  );
}

/**
 * Move the addresses of typed text into the recipient list (no duplicates).
 *
 * @param recipients - Recipients already added.
 * @param draft - Text typed in the field.
 * @returns New recipients and the text left (parts without "@").
 */
export function commitDraft(
  recipients: readonly string[],
  draft: string,
): { readonly recipients: string[]; readonly rest: string } {
  const parts = draft.split(ADDRESS_SEPARATOR).filter((part) => part !== '');
  const known = new Set(recipients.map((email) => email.toLowerCase()));
  const added = [...recipients];
  for (const part of parts.filter((value) => value.includes('@'))) {
    if (!known.has(part.toLowerCase())) {
      known.add(part.toLowerCase());
      added.push(part);
    }
  }
  return { recipients: added, rest: parts.filter((value) => !value.includes('@')).join(' ') };
}

/**
 * Join recipients into the field value sent to the server.
 *
 * @param recipients - Addresses.
 * @returns Comma separated list.
 */
export function joinRecipients(recipients: readonly string[]): string {
  return recipients.join(RECIPIENT_JOINER);
}

/**
 * Name shown in a list row: the sender, or the recipients of sent mail.
 *
 * @param mail - Message.
 * @returns Label.
 */
export function listName(
  mail: Pick<MailSummary, 'sender_name' | 'sender_email' | 'mailbox' | 'recipients'>,
): string {
  if (mail.mailbox !== 'sent') {
    return senderLabel(mail);
  }
  return mail.recipients.trim() === '' ? '(no recipient)' : `To: ${mail.recipients}`;
}

/** One address of a header. */
export interface MailAddress {
  readonly name: string;
  readonly email: string;
}

const ANGLE_ADDRESS = /^(.*)<([^>]+)>\s*$/;

/**
 * Split an address header on commas outside quotes and angle brackets.
 *
 * @param header - e.g. `"Doe, Ann" <a@x.org>, b@x.org`.
 * @returns Raw entries.
 */
function splitHeader(header: string): string[] {
  const entries: string[] = [];
  let current = '';
  let quoted = false;
  let angle = false;
  for (const char of header) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === '<') {
      angle = true;
    } else if (char === '>') {
      angle = false;
    }
    if (char === ',' && !quoted && !angle) {
      entries.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/**
 * Parse an address header (To, Cc) into names and emails.
 *
 * @param header - Header value.
 * @returns Addresses, in order.
 */
export function parseAddressList(header: string): MailAddress[] {
  return splitHeader(header).map((entry) => {
    const match = ANGLE_ADDRESS.exec(entry);
    if (match === null) {
      return { name: '', email: entry };
    }
    const name = (match[1] ?? '').trim().replace(/^"(.*)"$/, '$1');
    return { name, email: (match[2] ?? '').trim() };
  });
}

/**
 * Prefix a subject with "Fwd:" once.
 *
 * @param subject - Original subject.
 * @returns Forward subject.
 */
export function forwardSubject(subject: string): string {
  const trimmed = subject.trim();
  return FORWARD_PREFIX.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

/**
 * Forwarded message block: original headers, then the original text.
 *
 * @param mail - Forwarded message.
 * @returns Block placed below the new text.
 */
export function forwardBody(mail: MailDetail): string {
  const date = utcDate(mail.date).toLocaleString(undefined, QUOTE_DATE_OPTIONS);
  const from =
    mail.sender_name === '' ? mail.sender_email : `${mail.sender_name} <${mail.sender_email}>`;
  const headers = [
    '---------- Forwarded message ----------',
    `From: ${from}`,
    `Date: ${date}`,
    `Subject: ${mail.subject}`,
    `To: ${mail.recipients}`,
    ...(mail.cc === '' ? [] : [`Cc: ${mail.cc}`]),
  ];
  return `${headers.join('\n')}\n\n${mail.body_text}`;
}

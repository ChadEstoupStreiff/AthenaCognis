/** Mailbox views served by `GET /mail/messages?view=`. */
export const MAIL_VIEWS = [
  'priority',
  'pinned',
  'inbox',
  'unread',
  'needs_reply',
  'flagged',
  'others',
  'all',
  'sent',
  'blocked',
] as const;

/** One mailbox view. */
export type MailView = (typeof MAIL_VIEWS)[number];

/** How the client treats a sender. */
export type SenderFlag = 'vip' | 'normal' | 'muted' | 'blocked';

/** Message priority computed from sender flag, contacts and category. */
export type MailPriority = 'high' | 'normal' | 'low' | 'hidden';

/** Message category guessed from its headers. */
export type MailCategory = 'person' | 'newsletter' | 'notification';

/** Server protocol: IMAP/SMTP or Exchange Web Services. */
export type MailProtocol = 'imap' | 'ews';

/** Server preset of a provider (`GET /mail/providers`, empty host = typed by the user). */
export interface MailProvider {
  readonly key: string;
  readonly label: string;
  readonly protocol: MailProtocol;
  readonly imap_host: string;
  readonly imap_port: number;
  readonly smtp_host: string;
  readonly smtp_port: number;
  readonly help: string;
  /** Where to create an app password. */
  readonly help_url: string | null;
}

/** Mail account (the password never leaves the backend). */
export interface MailAccount {
  readonly id: string;
  readonly label: string;
  readonly protocol: MailProtocol;
  /** `#rrggbb`, marks the account's mail in lists. */
  readonly color: string;
  /** Added below messages written from this account. */
  readonly signature: string;
  readonly email: string;
  readonly username: string;
  readonly imap_host: string;
  readonly imap_port: number;
  readonly smtp_host: string;
  readonly smtp_port: number;
  readonly last_sync: string | null;
  readonly last_error: string | null;
}

/** Body of `POST/PUT /mail/accounts` (empty password on PUT keeps the stored one). */
export interface MailAccountInput {
  readonly label: string;
  readonly protocol: MailProtocol;
  readonly color: string;
  readonly signature: string;
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly imap_host: string;
  readonly imap_port: number;
  readonly smtp_host: string;
  readonly smtp_port: number;
}

/** Message row of the list. */
export interface MailSummary {
  readonly id: string;
  /** People contact of the sender (its photo is shown), null when unknown. */
  readonly contact_id: string | null;
  readonly account_id: string;
  readonly sender_email: string;
  readonly sender_name: string;
  readonly subject: string;
  readonly date: string;
  readonly snippet: string;
  readonly category: MailCategory;
  readonly is_read: boolean;
  readonly is_flagged: boolean;
  /** Pinned in AthenaCognis: listed first. */
  readonly is_pinned: boolean;
  /** Last time flagged for the Activity feed (naive UTC, AthenaCognis only); counts until the next activity reset time. */
  readonly activity_flagged_at: string | null;
  /** `inbox` (received) or `sent`. */
  readonly mailbox: 'inbox' | 'sent';
  /** Moved to the Trash (naive UTC), null when not deleted. */
  readonly trashed_at: string | null;
  readonly recipients: string;
  readonly has_attachments: boolean;
  readonly summary: string | null;
  readonly needs_reply: boolean | null;
  readonly suggested_action: string | null;
  /** Mail Preview: AI title (null until generated). */
  readonly preview_title: string | null;
  /** Mail Preview: AI summary, at most 40 words. */
  readonly preview_text: string | null;
  readonly sender_flag: SenderFlag;
  readonly priority: MailPriority;
}

/** Sender with treatment and stats. */
export interface MailSender {
  readonly email: string;
  readonly name: string;
  readonly flag: SenderFlag;
  readonly note: string;
  readonly contact_id: string | null;
  readonly message_count: number;
  readonly unread_count: number;
  readonly last_date: string | null;
}

/** Full message (`GET /mail/messages/{id}`). */
export interface MailDetail extends MailSummary {
  readonly cc: string;
  readonly body_text: string;
  readonly body_html: string | null;
  readonly attachments: readonly string[];
  readonly message_id: string | null;
  readonly sender: MailSender;
}

/** Outcome of a sync, per account. */
export interface MailSyncResult {
  readonly account_id: string;
  readonly fetched: number;
  readonly error: string | null;
}

/** File uploaded with `POST /mail/uploads`, attached to a message being written. */
export interface MailUploadRef {
  readonly id: string;
  readonly filename: string;
  readonly content_type: string;
  readonly size: number;
}

/** Body of `POST /mail/send`. */
export interface MailOutgoing {
  readonly account_id: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  /** Blind copies: delivered, never shown to the other recipients. */
  readonly bcc: readonly string[];
  readonly subject: string;
  /** Written text only: the server adds the account signature, then the quote. */
  readonly body: string;
  /** Formatted version of `body` (inline images as data URIs), null = plain text. */
  readonly body_html?: string | null;
  /** Uploaded files attached, in order. */
  readonly attachment_ids?: readonly string[];
  /** Quoted original (reply) or forwarded message, empty for a new message. */
  readonly quote: string;
  readonly reply_to_id: string | null;
  /** Draft the message was written in (removed from Drafts once queued). */
  readonly draft_id?: string | null;
}

/** What the compose dialog was opened for. */
export type MailDraftKind = 'new' | 'reply' | 'forward';

/** Body of `POST /mail/drafts` and `PUT /mail/drafts/{id}`: addresses may be incomplete. */
export interface MailDraftInput {
  readonly account_id: string;
  readonly kind: MailDraftKind;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  /** Blind copies: delivered, never shown to the other recipients. */
  readonly bcc: readonly string[];
  readonly subject: string;
  /** Written text only (signature and quote added when sending). */
  readonly body: string;
  /** Formatted version of `body` (inline images as data URIs), null = plain text. */
  readonly body_html?: string | null;
  /** Uploaded files attached, in order. */
  readonly attachment_ids?: readonly string[];
  /** Quoted original (reply) or forwarded message, empty for a new message. */
  readonly quote: string;
  readonly reply_to_id: string | null;
}

/** Saved draft (`GET /mail/drafts`), last edited first. */
export interface MailDraft extends MailDraftInput {
  readonly id: string;
  /** Files attached (still stored), in order. */
  readonly attachments?: readonly MailUploadRef[];
  /** Last save, naive UTC. */
  readonly updated: string;
  /** Moved to the Trash (naive UTC), null when not deleted. */
  readonly trashed_at: string | null;
}

/** Trash (`GET /mail/trash`): deleted mail and drafts, purged after the retention period. */
export interface MailTrash {
  /** Days an item stays in the Trash. */
  readonly retention_days: number;
  /** Deleted messages, last deleted first. */
  readonly messages: readonly MailSummary[];
  /** Deleted drafts, last deleted first. */
  readonly drafts: readonly MailDraft[];
}

/** State of an Outbox message. */
export type OutboxState = 'queued' | 'sending' | 'failed';

/** Message waiting in the Outbox (`GET /mail/outbox`) until the server accepts it. */
export interface MailOutboxItem {
  readonly id: string;
  readonly account_id: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  /** Written text (signature and quote added when sending). */
  readonly body: string;
  /** Naive UTC. */
  readonly created: string;
  readonly state: OutboxState;
  /** Last server error (failed messages). */
  readonly error: string | null;
  readonly attempts: number;
}

/** Address already seen in stored mail (`GET /mail/addresses`). */
export interface MailAddressSuggestion {
  readonly email: string;
  readonly name: string;
  readonly count: number;
  readonly last_date: string;
}

/** Body of `PATCH /mail/messages/{id}` (omitted = unchanged). */
export interface MailStateChange {
  readonly is_read?: boolean;
  readonly is_flagged?: boolean;
  readonly is_pinned?: boolean;
  /** Flag for the current activity day (false: remove that flag only). */
  readonly is_activity?: boolean;
}

/** Body of `PUT /mail/senders/{email}` (omitted = unchanged). */
export interface SenderChange {
  readonly flag?: SenderFlag;
  readonly note?: string;
}

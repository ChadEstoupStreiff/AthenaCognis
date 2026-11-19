import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  MailAccount,
  MailAccountInput,
  MailAddressSuggestion,
  MailDetail,
  MailDraft,
  MailDraftInput,
  MailOutboxItem,
  MailOutgoing,
  MailProvider,
  MailSender,
  MailStateChange,
  MailSummary,
  MailSyncResult,
  MailTrash,
  MailView,
  SenderChange,
  SenderFlag,
} from '@domain/contracts';
import { firstValueFrom } from 'rxjs';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Filters of the message list. */
export interface MailListQuery {
  readonly view: MailView;
  readonly accountId: string | null;
  readonly search: string;
  readonly sender: string | null;
  readonly limit: number;
  /** Only mail from this People contact. */
  readonly contactId?: string | null;
  /** Search filters (`/mail/messages` parameters, null = unset). */
  readonly filters?: Readonly<Record<string, string | boolean | null>>;
}

/**
 * URL of one sender.
 *
 * @param email - Address.
 * @returns Backend URL.
 */
function senderUrl(email: string): string {
  return backendUrl(`/mail/senders/${encodeURIComponent(email)}`);
}

/**
 * URL of one message.
 *
 * @param id - Message id.
 * @returns Backend URL.
 */
function messageUrl(id: string): string {
  return backendUrl(`/mail/messages/${encodeURIComponent(id)}`);
}

/** Mail client: accounts, sync, messages, senders, AI helpers. */
@Injectable({ providedIn: 'root' })
export class MailApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);
  private readonly http = inject(HttpClient);

  /**
   * Download URL of an attachment (fetched from the mail server on each request).
   *
   * @param messageId - Message id.
   * @param index - Attachment position, 0 = first.
   * @returns Backend URL.
   */
  attachmentUrl(messageId: string, index: number): string {
    return backendUrl(`/mail/messages/${encodeURIComponent(messageId)}/attachments/${index}`);
  }

  /**
   * Content of an attachment, for an in-page preview.
   *
   * @param messageId - Message id.
   * @param index - Attachment position, 0 = first.
   * @returns File content.
   */
  attachment(messageId: string, index: number): Promise<Blob> {
    return firstValueFrom(
      this.http.get(this.attachmentUrl(messageId, index), { responseType: 'blob' }),
    );
  }

  /**
   * Provider presets.
   *
   * @returns Presets.
   */
  providers(): Promise<MailProvider[]> {
    return this.api.get<MailProvider[]>(backendUrl('/mail/providers'));
  }

  /**
   * Accounts.
   *
   * @returns Accounts.
   */
  accounts(): Promise<MailAccount[]> {
    return this.api.get<MailAccount[]>(backendUrl('/mail/accounts'));
  }

  /**
   * Add or edit an account (the backend checks the login first).
   *
   * @param id - Account id, null to create.
   * @param input - Account fields.
   * @returns Saved account.
   */
  async saveAccount(id: string | null, input: MailAccountInput): Promise<MailAccount> {
    const account =
      id === null
        ? await this.api.post<MailAccount>(backendUrl('/mail/accounts'), input, { silent: true })
        : await this.api.put<MailAccount>(
            backendUrl(`/mail/accounts/${encodeURIComponent(id)}`),
            input,
            { silent: true },
          );
    this.sync.invalidate('mail');
    return account;
  }

  /**
   * Delete an account and its stored messages.
   *
   * @param id - Account id.
   */
  async deleteAccount(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/mail/accounts/${encodeURIComponent(id)}`));
    this.sync.invalidate('mail');
  }

  /**
   * Fetch new messages.
   *
   * @param accountId - Only this account, null for all.
   * @returns Results per account.
   */
  async syncNow(accountId: string | null): Promise<MailSyncResult[]> {
    const results = await this.api.post<MailSyncResult[]>(backendUrl('/mail/sync'), undefined, {
      params: { account_id: accountId },
    });
    this.sync.invalidate('mail');
    return results;
  }

  /**
   * Messages of a view.
   *
   * @param query - Filters.
   * @returns Message rows, newest first.
   */
  messages(query: MailListQuery): Promise<MailSummary[]> {
    return this.api.get<MailSummary[]>(backendUrl('/mail/messages'), {
      params: {
        view: query.view,
        account_id: query.accountId,
        search: query.search.trim() === '' ? null : query.search,
        sender: query.sender,
        contact_id: query.contactId ?? null,
        ...query.filters,
        limit: query.limit,
      },
    });
  }

  /**
   * Unread count per view.
   *
   * @param accountId - Only this account.
   * @returns View → count.
   */
  counts(accountId: string | null): Promise<Partial<Record<MailView, number>>> {
    return this.api.get(backendUrl('/mail/counts'), { params: { account_id: accountId } });
  }

  /**
   * One message.
   *
   * @param id - Message id.
   * @returns Message.
   */
  message(id: string): Promise<MailDetail> {
    return this.api.get<MailDetail>(messageUrl(id));
  }

  /**
   * Change the read/flag state (pushed to the server).
   *
   * @param id - Message id.
   * @param state - New state.
   * @returns Server error, if any (the local change is kept).
   */
  async setState(id: string, state: MailStateChange): Promise<string | null> {
    const result = await this.api.patch<{ server_error: string | null }>(messageUrl(id), state);
    this.sync.invalidate('mail');
    return result.server_error;
  }

  /**
   * Mark a whole view read.
   *
   * @param view - View.
   * @param accountId - Only this account.
   * @returns Messages marked.
   */
  async markAllRead(view: MailView, accountId: string | null): Promise<number> {
    const result = await this.api.post<{ marked: number }>(backendUrl('/mail/messages/read-all'), {
      view,
      account_id: accountId,
    });
    this.sync.invalidate('mail');
    return result.marked;
  }

  /**
   * AI triage of a message.
   *
   * @param id - Message id.
   * @returns Updated message.
   */
  async summarize(id: string): Promise<MailDetail> {
    const message = await this.api.post<MailDetail>(`${messageUrl(id)}/summarize`);
    this.sync.invalidate('mail');
    return message;
  }

  /**
   * Queue Mail Previews (AI title + 40-word summary).
   *
   * @param ids - Message ids.
   * @returns Messages queued.
   */
  async queuePreviews(ids: readonly string[]): Promise<number> {
    const result = await this.api.post<{ queued: number }>(backendUrl('/mail/previews'), { ids });
    return result.queued;
  }

  /**
   * Mail Previews waiting or running.
   *
   * @returns Open tasks.
   */
  async pendingPreviews(): Promise<number> {
    const result = await this.api.get<{ pending: number }>(backendUrl('/mail/previews/pending'), {
      silent: true,
    });
    return result.pending;
  }

  /**
   * AI reply draft.
   *
   * @param id - Message id.
   * @param instruction - What to say.
   * @returns Reply body.
   */
  async draftReply(id: string, instruction: string): Promise<string> {
    const result = await this.api.post<{ body: string }>(`${messageUrl(id)}/draft-reply`, {
      instruction,
    });
    return result.body;
  }

  /**
   * AI briefing of unread mail.
   *
   * @param accountId - Only this account.
   * @returns Markdown.
   */
  async digest(accountId: string | null): Promise<string> {
    const result = await this.api.post<{ markdown: string }>(backendUrl('/mail/digest'), {
      account_id: accountId,
    });
    return result.markdown;
  }

  /**
   * Queue a message in the Outbox (sent in the background).
   *
   * @param mail - Message.
   * @returns Queued Outbox message.
   */
  async send(mail: MailOutgoing): Promise<MailOutboxItem> {
    const queued = await this.api.post<MailOutboxItem>(backendUrl('/mail/send'), mail);
    this.sync.invalidate('mail', 'mail-drafts');
    return queued;
  }

  /**
   * Saved drafts.
   *
   * @returns Drafts, last edited first.
   */
  drafts(): Promise<MailDraft[]> {
    return this.api.get<MailDraft[]>(backendUrl('/mail/drafts'), { silent: true });
  }

  /**
   * Save a draft: create it, or overwrite it when `id` is given.
   *
   * @param draft - Compose fields.
   * @param id - Draft to overwrite, null creates one.
   * @returns Saved draft.
   */
  async saveDraft(draft: MailDraftInput, id: string | null): Promise<MailDraft> {
    const saved =
      id === null
        ? await this.api.post<MailDraft>(backendUrl('/mail/drafts'), draft)
        : await this.api.put<MailDraft>(
            backendUrl(`/mail/drafts/${encodeURIComponent(id)}`),
            draft,
          );
    this.sync.invalidate('mail-drafts');
    return saved;
  }

  /**
   * Move a draft to the Trash.
   *
   * @param id - Draft id.
   */
  async deleteDraft(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/mail/drafts/${encodeURIComponent(id)}`));
    this.sync.invalidate('mail-drafts', 'mail-trash');
  }

  /**
   * Put a trashed draft back in the Drafts box.
   *
   * @param id - Draft id.
   */
  async restoreDraft(id: string): Promise<void> {
    await this.api.post(backendUrl(`/mail/drafts/${encodeURIComponent(id)}/restore`));
    this.sync.invalidate('mail-drafts', 'mail-trash');
  }

  /**
   * Move a message to the Trash (local only, the server copy stays).
   *
   * @param id - Message id.
   */
  async deleteMessage(id: string): Promise<void> {
    await this.api.delete(messageUrl(id));
    this.sync.invalidate('mail', 'mail-trash');
  }

  /**
   * Put a trashed message back in its views.
   *
   * @param id - Message id.
   */
  async restoreMessage(id: string): Promise<void> {
    await this.api.post(`${messageUrl(id)}/restore`);
    this.sync.invalidate('mail', 'mail-trash');
  }

  /**
   * Trash content (items past the retention period are purged first).
   *
   * @returns Deleted messages and drafts.
   */
  trash(): Promise<MailTrash> {
    return this.api.get<MailTrash>(backendUrl('/mail/trash'), { silent: true });
  }

  /**
   * Remove every Trash item for good.
   *
   * @returns Items removed.
   */
  async emptyTrash(): Promise<number> {
    const result = await this.api.delete<{ purged: number }>(backendUrl('/mail/trash'));
    this.sync.invalidate('mail-trash');
    return result.purged;
  }

  /**
   * Messages waiting to be sent.
   *
   * @returns Outbox, oldest first.
   */
  outbox(): Promise<MailOutboxItem[]> {
    return this.api.get<MailOutboxItem[]>(backendUrl('/mail/outbox'), { silent: true });
  }

  /**
   * Queue a failed Outbox message again.
   *
   * @param id - Outbox id.
   */
  async retryOutgoing(id: string): Promise<void> {
    await this.api.post(backendUrl(`/mail/outbox/${encodeURIComponent(id)}/retry`));
    this.sync.invalidate('mail');
  }

  /**
   * Remove a message from the Outbox without sending it.
   *
   * @param id - Outbox id.
   */
  async discardOutgoing(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/mail/outbox/${encodeURIComponent(id)}`));
    this.sync.invalidate('mail');
  }

  /**
   * Addresses already seen in stored mail (senders, recipients, cc).
   *
   * @param search - Text typed in a recipient field.
   * @returns Suggestions, most frequent first.
   */
  suggestAddresses(search: string): Promise<MailAddressSuggestion[]> {
    return this.api.get<MailAddressSuggestion[]>(backendUrl('/mail/addresses'), {
      params: { search },
      silent: true,
    });
  }

  /**
   * Senders.
   *
   * @param flag - Only this flag.
   * @param search - Name or address.
   * @returns Senders, latest correspondents first.
   */
  senders(flag: SenderFlag | null, search: string): Promise<MailSender[]> {
    return this.api.get<MailSender[]>(backendUrl('/mail/senders'), {
      params: { flag, search: search.trim() === '' ? null : search },
    });
  }

  /**
   * Change how a sender is treated.
   *
   * @param email - Address.
   * @param change - New flag and/or note.
   * @returns Sender.
   */
  async updateSender(email: string, change: SenderChange): Promise<MailSender> {
    const sender = await this.api.put<MailSender>(senderUrl(email), change);
    this.sync.invalidate('mail');
    return sender;
  }

  /**
   * Save the note kept about a sender (no refetch: called while typing).
   *
   * @param email - Address.
   * @param note - Note.
   */
  async saveSenderNote(email: string, note: string): Promise<void> {
    await this.api.put(senderUrl(email), { note }, { silent: true });
  }

  /**
   * Link a sender to People (creates the contact when needed).
   *
   * @param email - Address.
   * @returns Contact id.
   */
  async linkContact(email: string): Promise<string> {
    const result = await this.api.post<{ contact_id: string }>(`${senderUrl(email)}/contact`);
    this.sync.invalidate('mail', 'contacts');
    return result.contact_id;
  }
}

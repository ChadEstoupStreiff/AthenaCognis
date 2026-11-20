import type { MailDraft, MailDraftInput, MailDraftKind, MailUploadRef } from '@domain/contracts';
import { joinRecipients, splitAddresses } from './mail-model';
import { textToHtml } from './rich-text';

/** Compose form. */
export interface ComposeForm {
  readonly accountId: string;
  readonly to: string;
  readonly cc: string;
  readonly subject: string;
  /** Written text as plain text (previews, plain part). */
  readonly body: string;
  /** Written text as formatted HTML, empty when nothing written. */
  readonly bodyHtml: string;
  /** Files attached, in order. */
  readonly attachments: readonly MailUploadRef[];
}

/** Message context a draft keeps besides the form. */
export interface DraftContext {
  readonly kind: MailDraftKind;
  readonly quote: string;
  readonly replyToId: string | null;
}

/**
 * Tell whether the user typed something worth keeping.
 *
 * @param form - Compose form.
 * @returns True when a recipient, the subject, the text, an image or a file is filled.
 */
export function hasContent(form: ComposeForm): boolean {
  const fields = [form.to, form.cc, form.subject, form.body, form.bodyHtml];
  return form.attachments.length > 0 || fields.some((value) => value.trim() !== '');
}

/**
 * Ids of the attached files, in order.
 *
 * @param form - Compose form.
 * @returns Upload ids.
 */
export function attachmentIds(form: ComposeForm): string[] {
  return form.attachments.map((file) => file.id);
}

/**
 * Tell whether two forms hold the same values.
 *
 * @param left - Form.
 * @param right - Form.
 * @returns True when every field matches.
 */
export function sameForm(left: ComposeForm, right: ComposeForm): boolean {
  return (
    left.accountId === right.accountId &&
    left.to === right.to &&
    left.cc === right.cc &&
    left.subject === right.subject &&
    left.body === right.body &&
    left.bodyHtml === right.bodyHtml &&
    attachmentIds(left).join() === attachmentIds(right).join()
  );
}

/**
 * Build the draft saved for a compose form.
 *
 * @param form - Compose form.
 * @param context - Kind, quote and replied message.
 * @returns Body of the draft save.
 */
export function draftInput(form: ComposeForm, context: DraftContext): MailDraftInput {
  return {
    account_id: form.accountId,
    kind: context.kind,
    to: splitAddresses(form.to),
    cc: splitAddresses(form.cc),
    subject: form.subject,
    body: form.body,
    body_html: form.bodyHtml === '' ? null : form.bodyHtml,
    attachment_ids: attachmentIds(form),
    quote: context.quote,
    reply_to_id: context.replyToId,
  };
}

/**
 * Fill the compose form from a saved draft.
 *
 * @param draft - Saved draft.
 * @returns Compose form.
 */
export function formOfDraft(draft: MailDraft): ComposeForm {
  return {
    accountId: draft.account_id,
    to: joinRecipients(draft.to),
    cc: joinRecipients(draft.cc),
    subject: draft.subject,
    body: draft.body,
    bodyHtml: draft.body_html ?? textToHtml(draft.body),
    attachments: draft.attachments ?? [],
  };
}

/** Run async saves one after the other, so a draft is created once then only updated. */
export class SaveQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Run a task after every task queued before it.
   *
   * @param task - Save to run.
   * @returns The task's result.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /**
   * Wait until every queued task has finished (failed ones included).
   *
   * @returns Resolves when idle.
   */
  async idle(): Promise<void> {
    await this.tail;
  }
}

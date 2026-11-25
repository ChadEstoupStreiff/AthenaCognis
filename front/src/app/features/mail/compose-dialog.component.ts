import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type {
  MailAccount,
  MailDetail,
  MailDraft,
  MailDraftKind,
  MailUploadRef,
} from '@domain/contracts';
import DOMPurify from 'dompurify';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MailApi } from '../../core/mail/mail.api';
import { NotifyService } from '../../core/notify/notify.service';
import { formatBytes } from '../../shared/pipes/bytes.pipe';
import { MailAddressInputComponent } from './address-input.component';
import {
  attachmentIds,
  type ComposeForm,
  draftInput,
  formOfDraft,
  hasContent,
  sameForm,
  SaveQueue,
} from './compose-draft';
import {
  forwardBody,
  forwardSubject,
  isHtmlSignature,
  mailTime,
  quoteBody,
  replySubject,
  splitAddresses,
} from './mail-model';
import { MailRichEditorComponent, type RichContent } from './rich-editor.component';
import { textToHtml } from './rich-text';

/** Pause in typing after which the draft is saved. */
const AUTOSAVE_DELAY_MS = 3_000;
/** Largest message most mail servers accept, 25 MB (also the server's per-file limit). */
const MAX_ATTACHMENT_BYTES = 26_214_400;
const SIGNATURE_FORBIDDEN_TAGS = ['form', 'input', 'button', 'iframe', 'object', 'embed', 'style'];

/**
 * Remove one occurrence of each name from a list.
 *
 * @param names - List.
 * @param removed - Names to remove once each.
 * @returns Remaining names.
 */
function withoutNames(names: readonly string[], removed: readonly string[]): string[] {
  const remaining = [...names];
  for (const name of removed) {
    const index = remaining.indexOf(name);
    if (index !== -1) {
      remaining.splice(index, 1);
    }
  }
  return remaining;
}

/** Dialog title per kind of message. */
const KIND_TITLE: Readonly<Record<MailDraftKind, string>> = {
  new: 'New message',
  reply: 'Reply',
  forward: 'Forward',
};

/** Write a new message, a reply or a forward; closing without sending keeps a draft. */
@Component({
  selector: 'ac-mail-compose-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MailAddressInputComponent,
    MailRichEditorComponent,
    SelectModule,
  ],
  template: `
    <p-dialog
      [modal]="true"
      [visible]="visible() && !minimized()"
      (visibleChange)="onVisibleChange($event)"
      [maximizable]="true"
      [style]="{ width: 'min(760px, 96vw)' }"
    >
      <ng-template #header>
        <span class="header">
          <span class="p-dialog-title">{{ title() }}</span>
          <p-button
            icon="pi pi-window-minimize"
            severity="secondary"
            [text]="true"
            [rounded]="true"
            ariaLabel="Minimize"
            (mousedown)="$event.stopPropagation()"
            (onClick)="minimized.set(true)"
          />
        </span>
      </ng-template>
      <div class="form" (dragover)="$event.preventDefault()" (drop)="onDropFiles($event)">
        <label class="row">
          <span>From</span>
          <p-select
            [options]="accounts()"
            optionLabel="email"
            optionValue="id"
            [ngModel]="form().accountId"
            (ngModelChange)="patch({ accountId: $event })"
            [fluid]="true"
            appendTo="body"
          />
        </label>
        <div class="row">
          <span>To</span>
          <ac-mail-address-input
            label="To"
            [value]="form().to"
            (valueChange)="patch({ to: $event })"
          />
        </div>
        <div class="row" [class.with-action]="!bccShown()">
          <span>Cc</span>
          <ac-mail-address-input
            label="Cc"
            [value]="form().cc"
            (valueChange)="patch({ cc: $event })"
          />
          @if (!bccShown()) {
            <p-button
              label="Bcc"
              severity="secondary"
              [text]="true"
              size="small"
              ariaLabel="Add blind copy recipients"
              (onClick)="bccOpened.set(true)"
            />
          }
        </div>
        @if (bccShown()) {
          <div class="row">
            <span title="Blind copy: hidden from the other recipients">Bcc</span>
            <ac-mail-address-input
              label="Bcc"
              [value]="form().bcc"
              (valueChange)="patch({ bcc: $event })"
            />
          </div>
        }
        <label class="row">
          <span>Subject</span>
          <input
            pInputText
            [ngModel]="form().subject"
            (ngModelChange)="patch({ subject: $event })"
          />
        </label>
        @if (replyTo()) {
          <div class="ai">
            <input
              pInputText
              placeholder="What should the reply say? (e.g. accept, propose Thursday 2pm)"
              [(ngModel)]="instruction"
              (keydown.enter)="draft()"
            />
            <p-button
              label="Draft with AI"
              icon="pi pi-sparkles"
              severity="secondary"
              [outlined]="true"
              [loading]="drafting()"
              (onClick)="draft()"
            />
          </div>
        }
        <ac-mail-rich-editor
          [html]="form().bodyHtml"
          placeholder="Write your message…"
          (contentChange)="onBody($event)"
          (filesDropped)="attachFiles($event)"
        />
        @if (form().attachments.length > 0 || uploading().length > 0) {
          <ul class="attachments" aria-label="Attachments">
            @for (file of form().attachments; track file.id) {
              <li>
                <i class="pi pi-paperclip" aria-hidden="true"></i>
                <span class="name" [title]="file.filename">{{ file.filename }}</span>
                <span class="ac-muted">{{ sizeLabel(file.size) }}</span>
                <p-button
                  icon="pi pi-times"
                  severity="secondary"
                  [text]="true"
                  [rounded]="true"
                  size="small"
                  [ariaLabel]="'Remove ' + file.filename"
                  (onClick)="removeAttachment(file)"
                />
              </li>
            }
            @for (name of uploading(); track $index) {
              <li class="ac-muted">
                <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
                <span class="name">{{ name }}</span>
              </li>
            }
          </ul>
        }
        @if (signatureHtml(); as html) {
          <div class="signature" aria-label="Signature" [innerHTML]="html"></div>
        } @else if (signatureText(); as text) {
          <div class="signature plain" aria-label="Signature">{{ text }}</div>
        }
        @if (quote(); as quoted) {
          <pre class="quote" aria-label="Quoted message">{{ quoted }}</pre>
        }
      </div>
      <ng-template #footer>
        <span class="footer-start">
          <p-button
            label="Attach"
            icon="pi pi-paperclip"
            severity="secondary"
            [text]="true"
            (onClick)="filePicker.click()"
          />
          <input #filePicker type="file" multiple hidden (change)="onPicked($event)" />
          @if (savedAt(); as time) {
            <span class="ac-muted">Draft saved {{ time }}</span>
          }
        </span>
        <p-button label="Discard" severity="secondary" [text]="true" (onClick)="discard()" />
        <p-button
          label="Save draft"
          icon="pi pi-save"
          severity="secondary"
          [outlined]="true"
          [loading]="saving()"
          (onClick)="saveDraft()"
        />
        <p-button label="Send" icon="pi pi-send" [loading]="sending()" (onClick)="send()" />
      </ng-template>
    </p-dialog>
    @if (visible() && minimized()) {
      <div class="minimized ac-panel" role="region" [attr.aria-label]="title() + ' (minimized)'">
        <button type="button" class="restore" (click)="minimized.set(false)">
          <i class="pi pi-envelope" aria-hidden="true"></i>
          <span class="label">
            <strong>{{ title() }}</strong>
            <span class="ac-muted">{{ form().subject || '(no subject)' }}</span>
          </span>
        </button>
        <p-button
          icon="pi pi-window-maximize"
          severity="secondary"
          [text]="true"
          [rounded]="true"
          ariaLabel="Restore"
          (onClick)="minimized.set(false)"
        />
        <p-button
          icon="pi pi-times"
          severity="secondary"
          [text]="true"
          [rounded]="true"
          ariaLabel="Close and keep draft"
          (onClick)="onVisibleChange(false)"
        />
      </div>
    }
  `,
  styles: `
    .header {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .minimized {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 1100;
      display: flex;
      align-items: center;
      gap: 4px;
      width: min(340px, calc(100vw - 32px));
      padding: 6px 6px 6px 12px;
      border-radius: 10px;
      box-shadow: 0 6px 24px rgb(0 0 0 / 25%);
    }
    .restore {
      display: flex;
      flex: 1;
      min-width: 0;
      align-items: center;
      gap: 10px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .label {
      display: flex;
      flex-direction: column;
      min-width: 0;
      font-size: 13px;
      span {
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .row {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--ac-muted);
    }
    .row.with-action {
      grid-template-columns: 64px minmax(0, 1fr) auto;
    }
    .ai {
      display: flex;
      gap: 8px;
      input {
        flex: 1;
      }
    }
    input {
      width: 100%;
    }
    .signature,
    .quote {
      padding: 8px 10px;
      border: 1px dashed var(--ac-panel-border);
      border-radius: 8px;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .signature {
      max-height: 200px;
      overflow: auto;
    }
    .signature :is(img) {
      max-width: 100%;
      height: auto;
    }
    .plain,
    .quote {
      white-space: pre-wrap;
    }
    .footer-start {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-right: auto;
      font-size: 12px;
    }
    .attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
      li {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 2px 4px 2px 10px;
        border: 1px solid var(--ac-panel-border);
        border-radius: 999px;
        font-size: 12px;
      }
      .name {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    .quote {
      max-height: 180px;
      margin: 0;
      overflow: auto;
      font-family: inherit;
      color: var(--ac-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailComposeDialogComponent {
  private readonly mail = inject(MailApi);
  private readonly notify = inject(NotifyService);
  private readonly sanitizer = inject(DomSanitizer);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Collapsed to a bar at the bottom right (two-way), so other mail stays browsable. */
  readonly minimized = model(false);
  /** Accounts to send from. */
  readonly accounts = input.required<MailAccount[]>();
  /** Message answered (`null` writes a new message). */
  readonly replyTo = input<MailDetail | null>(null);
  /** Recipient prefilled on new messages. */
  readonly recipient = input<string | null>(null);
  /** Message forwarded (`null` = not a forward). */
  readonly forwardOf = input<MailDetail | null>(null);
  /** Saved draft resumed (`null` = fresh message). */
  readonly savedDraft = input<MailDraft | null>(null);

  /** New message, reply or forward (a resumed draft keeps its own). */
  private readonly kind = computed<MailDraftKind>(() => {
    if (this.forwardOf() !== null) {
      return 'forward';
    }
    if (this.replyTo() !== null) {
      return 'reply';
    }
    return this.savedDraft()?.kind ?? 'new';
  });
  protected readonly title = computed(() => KIND_TITLE[this.kind()]);

  /** Quoted original of the replied, forwarded or drafted message (read-only). */
  protected readonly quote = computed(() => {
    const forwarded = this.forwardOf();
    if (forwarded !== null) {
      return forwardBody(forwarded);
    }
    const original = this.replyTo();
    return original === null ? (this.savedDraft()?.quote ?? '') : quoteBody(original);
  });
  /** Replied message id (kept by drafts of replies). */
  private readonly replyToId = computed(
    () => this.replyTo()?.id ?? this.savedDraft()?.reply_to_id ?? null,
  );

  /** Signature of the sending account (follows "From", not editable here). */
  private readonly signature = computed(() => this.signatureOf(this.form().accountId).trim());
  /** HTML signature, sanitized, or null for a plain one. */
  protected readonly signatureHtml = computed<SafeHtml | null>(() => {
    const signature = this.signature();
    if (!isHtmlSignature(signature)) {
      return null;
    }
    const clean = DOMPurify.sanitize(signature, { FORBID_TAGS: SIGNATURE_FORBIDDEN_TAGS });
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  });
  /** Plain text signature, empty when HTML or none. */
  protected readonly signatureText = computed(() =>
    isHtmlSignature(this.signature()) ? '' : this.signature(),
  );

  protected readonly form = signal<ComposeForm>({
    accountId: '',
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    bodyHtml: '',
    attachments: [],
  });
  /** Bcc row opened by its button (it also shows whenever Bcc holds addresses). */
  protected readonly bccOpened = signal(false);
  protected readonly bccShown = computed(() => this.bccOpened() || this.form().bcc !== '');
  protected instruction = '';
  protected readonly drafting = signal(false);
  protected readonly sending = signal(false);
  protected readonly saving = signal(false);
  /** Names of files being uploaded. */
  protected readonly uploading = signal<readonly string[]>([]);
  protected readonly sizeLabel = formatBytes;
  /** Time of the last draft save, shown in the footer (null = not saved). */
  protected readonly savedAt = signal<string | null>(null);
  /** Saves run one at a time: the first creates the draft, later ones update it. */
  private readonly saves = new SaveQueue();
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Draft this message is saved in, null until first saved. */
  private readonly draftId = signal<string | null>(null);
  /** Form as last saved (or opened): closing unchanged keeps no new draft. */
  private savedForm: ComposeForm = this.form();
  /** Sent or discarded: closing must not save a draft. */
  private finished = false;

  /** Prefill when the dialog opens; save a draft after each pause in typing. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.reset();
        });
      }
    });
    effect(() => {
      this.form();
      untracked(() => {
        this.scheduleAutosave();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.autosaveTimer);
      void this.keepDraft().then((saved) => {
        if (saved) {
          this.notify.info('Saved in Drafts');
        }
      });
    });
  }

  /**
   * Change some fields.
   *
   * @param change - Fields.
   */
  protected patch(change: Partial<ComposeForm>): void {
    this.form.update((form) => ({ ...form, ...change }));
  }

  /**
   * Follow the editor: plain text and formatted HTML.
   *
   * @param content - Written content.
   */
  protected onBody(content: RichContent): void {
    this.patch({ body: content.text, bodyHtml: content.html });
  }

  /**
   * Attach files picked in the file dialog.
   *
   * @param event - File input change.
   */
  protected async onPicked(event: Event): Promise<void> {
    const picker = event.target as HTMLInputElement;
    const files = Array.from(picker.files ?? []);
    picker.value = '';
    await this.attachFiles(files);
  }

  /**
   * Attach files dropped on the form (outside the editor).
   *
   * @param event - Drop event.
   */
  protected async onDropFiles(event: DragEvent): Promise<void> {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    await this.attachFiles(files);
  }

  /**
   * Upload files and attach them (files above the size limit are refused).
   *
   * @param files - Files.
   */
  protected async attachFiles(files: readonly File[]): Promise<void> {
    const tooLarge = files.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge.length > 0) {
      const names = tooLarge.map((file) => file.name).join(', ');
      this.notify.warn(`Not attached (above ${formatBytes(MAX_ATTACHMENT_BYTES)}): ${names}`);
    }
    const accepted = files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    await Promise.allSettled(accepted.map((file) => this.uploadOne(file)));
    const total = this.form().attachments.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      this.notify.warn(
        `Attachments total ${formatBytes(total)}: many mail servers refuse messages this large.`,
      );
    }
  }

  /**
   * Remove an attached file.
   *
   * @param file - Attachment.
   */
  protected removeAttachment(file: MailUploadRef): void {
    this.patch({ attachments: this.form().attachments.filter((item) => item.id !== file.id) });
  }

  /**
   * Attach the files of the forwarded message (copied on the server).
   *
   * @param forwarded - Forwarded message.
   */
  private async attachForwarded(forwarded: MailDetail): Promise<void> {
    const names = forwarded.attachments;
    this.uploading.update((current) => [...current, ...names]);
    try {
      const files = await this.mail.forwardAttachments(forwarded.id);
      const untouched = sameForm(this.form(), this.savedForm);
      this.patch({ attachments: [...files, ...this.form().attachments] });
      if (untouched) {
        this.savedForm = this.form();
      }
      if (files.length < names.length) {
        this.notify.warn('Some attachments were too large to forward.');
      }
    } finally {
      this.uploading.update((current) => withoutNames(current, names));
    }
  }

  /**
   * Upload one file and add it to the attachments.
   *
   * @param file - File.
   */
  private async uploadOne(file: File): Promise<void> {
    this.uploading.update((names) => [...names, file.name]);
    try {
      const stored = await this.mail.uploadAttachment(file);
      this.patch({ attachments: [...this.form().attachments, stored] });
    } finally {
      this.uploading.update((names) => withoutNames(names, [file.name]));
    }
  }

  /** Ask the AI for a reply text (signature and quote stay below). */
  protected async draft(): Promise<void> {
    const original = this.replyTo();
    if (original === null) {
      return;
    }
    this.drafting.set(true);
    try {
      const body = await this.mail.draftReply(original.id, this.instruction);
      this.patch({ body, bodyHtml: textToHtml(body) });
    } finally {
      this.drafting.set(false);
    }
  }

  /**
   * Signature of an account.
   *
   * @param accountId - Account id.
   * @returns Signature, empty when none.
   */
  private signatureOf(accountId: string): string {
    return this.accounts().find((account) => account.id === accountId)?.signature ?? '';
  }

  /** Send and close. */
  protected async send(): Promise<void> {
    const form = this.form();
    const to = splitAddresses(form.to);
    if (form.accountId === '' || to.length === 0) {
      this.notify.warn('Pick an account and at least one recipient.');
      return;
    }
    if (this.uploading().length > 0) {
      this.notify.warn('Wait for the attachments to finish uploading.');
      return;
    }
    clearTimeout(this.autosaveTimer);
    this.finished = true;
    this.sending.set(true);
    try {
      await this.saves.idle();
      await this.mail.send({
        account_id: form.accountId,
        to,
        cc: splitAddresses(form.cc),
        bcc: splitAddresses(form.bcc),
        subject: form.subject,
        body: form.body,
        body_html: form.bodyHtml === '' ? null : form.bodyHtml,
        attachment_ids: attachmentIds(form),
        quote: this.quote(),
        reply_to_id: this.replyToId(),
        draft_id: this.draftId(),
      });
      this.notify.success('Queued in Outbox');
      this.close();
    } catch (error) {
      this.finished = false;
      throw error;
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Follow the dialog's own close (X button, Escape): keep a draft first.
   *
   * @param visible - New visibility.
   */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      clearTimeout(this.autosaveTimer);
      void this.keepDraft().then((saved) => {
        if (saved) {
          this.notify.info('Saved in Drafts');
        }
      });
    }
    this.visible.set(visible);
  }

  /** Save the draft on demand and keep writing. */
  protected async saveDraft(): Promise<void> {
    if (this.form().accountId === '') {
      this.notify.warn('Pick an account to save a draft.');
      return;
    }
    clearTimeout(this.autosaveTimer);
    if (await this.saves.run(() => this.storeDraft())) {
      this.notify.success('Draft saved');
    }
  }

  /** Close without sending and delete the saved draft, if any (after pending saves). */
  protected async discard(): Promise<void> {
    clearTimeout(this.autosaveTimer);
    this.close();
    await this.saves.idle();
    const draftId = this.draftId();
    if (draftId !== null) {
      await this.mail.deleteDraft(draftId);
    }
  }

  /** Close for good (sent or discarded): no draft is kept. */
  private close(): void {
    this.finished = true;
    this.visible.set(false);
  }

  /** Save the draft once typing pauses (restarted by each change). */
  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    if (!this.visible() || this.finished) {
      return;
    }
    this.autosaveTimer = setTimeout(() => {
      void this.keepDraft();
    }, AUTOSAVE_DELAY_MS);
  }

  /**
   * Save unsaved changes in Drafts (autosave and close), skipped when nothing worth keeping.
   *
   * @returns True when a save ran.
   */
  private keepDraft(): Promise<boolean> {
    return this.saves.run(async () => {
      const form = this.form();
      const worthSaving = hasContent(form) && !sameForm(form, this.savedForm);
      if (this.finished || form.accountId === '' || !worthSaving) {
        return false;
      }
      return this.storeDraft();
    });
  }

  /**
   * Create or overwrite the draft of this message (call through `saves`).
   *
   * @returns True once saved.
   */
  private async storeDraft(): Promise<boolean> {
    const form = this.form();
    this.saving.set(true);
    try {
      const context = { kind: this.kind(), quote: this.quote(), replyToId: this.replyToId() };
      const saved = await this.mail.saveDraft(draftInput(form, context), this.draftId());
      this.draftId.set(saved.id);
      this.savedForm = form;
      this.savedAt.set(mailTime(saved.updated));
      return true;
    } finally {
      this.saving.set(false);
    }
  }

  /** Fill the form from a draft, the replied or forwarded message, or a blank message. */
  private reset(): void {
    this.finished = false;
    this.minimized.set(false);
    this.instruction = '';
    this.bccOpened.set(false);
    const draft = this.savedDraft();
    this.draftId.set(draft?.id ?? null);
    this.savedAt.set(draft === null ? null : mailTime(draft.updated));
    this.form.set(draft === null ? this.freshForm() : formOfDraft(draft));
    this.savedForm = this.form();
    const forwarded = this.forwardOf();
    if (draft === null && forwarded !== null && forwarded.attachments.length > 0) {
      void this.attachForwarded(forwarded);
    }
  }

  /**
   * Form of a new message, a reply or a forward.
   *
   * @returns Prefilled form.
   */
  private freshForm(): ComposeForm {
    const original = this.replyTo();
    const forwarded = this.forwardOf();
    const accountId = original?.account_id ?? forwarded?.account_id ?? this.accounts()[0]?.id ?? '';
    const empty = { bcc: '', body: '', bodyHtml: '', attachments: [] };
    if (forwarded !== null) {
      return { accountId, to: '', cc: '', subject: forwardSubject(forwarded.subject), ...empty };
    }
    return original === null
      ? { accountId, to: this.recipient() ?? '', cc: '', subject: '', ...empty }
      : {
          accountId,
          to: original.sender_email,
          cc: '',
          subject: replySubject(original.subject),
          ...empty,
        };
  }
}

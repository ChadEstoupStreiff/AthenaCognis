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
import type { MailAccount, MailDetail, MailDraft, MailDraftKind } from '@domain/contracts';
import DOMPurify from 'dompurify';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { MailApi } from '../../core/mail/mail.api';
import { NotifyService } from '../../core/notify/notify.service';
import { MailAddressInputComponent } from './address-input.component';
import {
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

const BODY_ROWS = 14;
/** Pause in typing after which the draft is saved. */
const AUTOSAVE_DELAY_MS = 3_000;
const SIGNATURE_FORBIDDEN_TAGS = ['form', 'input', 'button', 'iframe', 'object', 'embed', 'style'];

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
    SelectModule,
    TextareaModule,
  ],
  template: `
    <p-dialog
      [header]="title()"
      [modal]="true"
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      [maximizable]="true"
      [style]="{ width: 'min(760px, 96vw)' }"
    >
      <div class="form">
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
        <div class="row">
          <span>Cc</span>
          <ac-mail-address-input
            label="Cc"
            [value]="form().cc"
            (valueChange)="patch({ cc: $event })"
          />
        </div>
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
        <textarea
          pTextarea
          [rows]="bodyRows"
          [ngModel]="form().body"
          (ngModelChange)="patch({ body: $event })"
          aria-label="Message"
        ></textarea>
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
        @if (savedAt(); as time) {
          <span class="saved-at ac-muted">Draft saved {{ time }}</span>
        }
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
  `,
  styles: `
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
    .ai {
      display: flex;
      gap: 8px;
      input {
        flex: 1;
      }
    }
    input,
    textarea {
      width: 100%;
    }
    textarea {
      font-family: inherit;
      resize: vertical;
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
    .saved-at {
      margin-right: auto;
      align-self: center;
      font-size: 12px;
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

  protected readonly bodyRows = BODY_ROWS;
  protected readonly form = signal<ComposeForm>({
    accountId: '',
    to: '',
    cc: '',
    subject: '',
    body: '',
  });
  protected instruction = '';
  protected readonly drafting = signal(false);
  protected readonly sending = signal(false);
  protected readonly saving = signal(false);
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

  /** Ask the AI for a reply text (signature and quote stay below). */
  protected async draft(): Promise<void> {
    const original = this.replyTo();
    if (original === null) {
      return;
    }
    this.drafting.set(true);
    try {
      const body = await this.mail.draftReply(original.id, this.instruction);
      this.patch({ body });
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
    clearTimeout(this.autosaveTimer);
    this.finished = true;
    this.sending.set(true);
    try {
      await this.saves.idle();
      await this.mail.send({
        account_id: form.accountId,
        to,
        cc: splitAddresses(form.cc),
        subject: form.subject,
        body: form.body,
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
    this.instruction = '';
    const draft = this.savedDraft();
    this.draftId.set(draft?.id ?? null);
    this.savedAt.set(draft === null ? null : mailTime(draft.updated));
    this.form.set(draft === null ? this.freshForm() : formOfDraft(draft));
    this.savedForm = this.form();
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
    const body = '';
    if (forwarded !== null) {
      return { accountId, to: '', cc: '', subject: forwardSubject(forwarded.subject), body };
    }
    return original === null
      ? { accountId, to: this.recipient() ?? '', cc: '', subject: '', body }
      : {
          accountId,
          to: original.sender_email,
          cc: '',
          subject: replySubject(original.subject),
          body,
        };
  }
}

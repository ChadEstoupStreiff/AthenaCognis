import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { colorForName, readableTextColor } from '@domain/color';
import type {
  MailDetail,
  MailDraft,
  MailStateChange,
  MailSummary,
  MailView,
  SenderFlag,
} from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { PopoverModule } from 'primeng/popover';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { MailApi } from '../../core/mail/mail.api';
import { NotifyService } from '../../core/notify/notify.service';
import { AutosaveController } from '../../core/state/autosave';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';
import { ContactAvatarComponent } from '../../shared/ui/contact-avatar.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { persistedWidth } from '../../shared/ui/persisted-width';
import { ResizeHandleComponent } from '../../shared/ui/resize-handle.component';
import { SaveStatusComponent } from '../../shared/ui/save-status.component';
import { triggerDownload } from '../../core/files/files.api';
import { type AttachmentPreviewKind, type AttachmentRef, previewType } from './attachment-preview';
import { MailAttachmentPreviewComponent } from './attachment-preview-dialog.component';
import { MailComposeDialogComponent } from './compose-dialog.component';
import { MailDraftsComponent } from './drafts-panel.component';
import { MailDraftsStore } from './drafts.store';
import { MailAddressesComponent } from './mail-addresses.component';
import { MailFiltersPanelComponent } from './mail-filters-panel.component';
import { activeFilterCount, EMPTY_FILTERS, filterParams, type MailFilters } from './mail-filters';
import { MailFrameComponent } from './mail-frame.component';
import { PreviewIconComponent } from './preview-icon.component';
import {
  FLAG_META,
  isActivityToday,
  listName,
  mailTime,
  PRIORITY_VIEW,
  senderLabel,
  VIEW_META,
} from './mail-model';
import { MailOutboxComponent } from './outbox-panel.component';
import { MailOutboxStore } from './outbox.store';
import { MailTrashComponent } from './trash-panel.component';
import { MailTrashStore } from './trash.store';
import { SendersPanelComponent } from './senders-panel.component';

/** Yellow lightning of the "Add to Activity feed" button (off: icon only, on: filled). */
const ACTIVITY_OFF_STYLE = { color: 'var(--p-yellow-500)' };
const ACTIVITY_ON_STYLE = {
  color: 'var(--p-surface-900)',
  background: 'var(--p-yellow-400)',
  borderColor: 'var(--p-yellow-400)',
};
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;
const AUTO_SYNC_MS = 300_000;
const NOTE_ROWS = 3;
const INITIALS = 2;
const PREVIEW_POLL_MS = 4_000;
const SIDE_WIDTH_KEY = 'ac.mail.sideWidth';
const DEFAULT_SIDE_WIDTH = 220;
const SIDE_MIN_WIDTH = 180;
const MAIN_MIN_WIDTH = 420;
const CONTACT_WIDTH_KEY = 'ac.mail.contactWidth';
const CONTACT_MIN_WIDTH = 200;
const SENDER_MIN_WIDTH = 280;
/** Avatar sizes (px), matching `.avatar` and `.avatar.large` in the stylesheet. */
const AVATAR_SIZE = 34;
const LARGE_AVATAR_SIZE = 42;

/** Icon of each previewable attachment kind. */
const ATTACHMENT_ICONS: Readonly<Record<AttachmentPreviewKind, string>> = {
  image: 'pi pi-image',
  video: 'pi pi-video',
  audio: 'pi pi-volume-up',
  pdf: 'pi pi-file-pdf',
  text: 'pi pi-file',
};

/** What the compose dialog opens with. */
interface ComposeRequest {
  readonly replyTo: MailDetail | null;
  readonly forwardOf?: MailDetail | null;
  readonly to: string | null;
  /** Saved draft to resume. */
  readonly draft?: MailDraft | null;
}

/**
 * Copy of a set with one id added or removed.
 *
 * @param set - Current ids.
 * @param id - Id to flip.
 * @returns New set.
 */
function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

/** Mail client: smart views, AI triage, sender flags, reply. */
@Component({
  selector: 'ac-mail-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    TextareaModule,
    TooltipModule,
    ContactAvatarComponent,
    MarkdownViewComponent,
    ResizeHandleComponent,
    SaveStatusComponent,
    MailAttachmentPreviewComponent,
    MailComposeDialogComponent,
    MailDraftsComponent,
    MailAddressesComponent,
    MailFrameComponent,
    MailFiltersPanelComponent,
    PopoverModule,
    PreviewIconComponent,
    SendersPanelComponent,
    MailOutboxComponent,
    MailTrashComponent,
  ],
  templateUrl: './mail.page.html',
  host: { '(document:keydown.escape)': 'onEscape()' },
  styleUrl: './mail.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailPage {
  protected readonly activityOffStyle = ACTIVITY_OFF_STYLE;
  protected readonly activityOnStyle = ACTIVITY_ON_STYLE;
  private readonly mail = inject(MailApi);
  /** Outbox: mail waiting to be sent (count in the sidebar). */
  protected readonly outbox = inject(MailOutboxStore);
  /** Drafts box (count in the sidebar). */
  protected readonly drafts = inject(MailDraftsStore);
  /** Trash: deleted mail and drafts (count in the sidebar). */
  protected readonly trash = inject(MailTrashStore);
  private readonly sync = inject(DataSync);
  private readonly notify = inject(NotifyService);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Message whose sender note is loaded (refetches keep the note being typed). */
  private noteOwner: string | null = null;

  /** Query parameter: message to open (links from People and Activity). */
  readonly open = input<string | undefined>(undefined);

  protected readonly views = VIEW_META;
  /** Sender treatments for the select button (needs a mutable array). */
  protected readonly flagOptions = [...FLAG_META];
  protected readonly noteRows = NOTE_ROWS;
  protected readonly senderLabel = senderLabel;
  protected readonly listName = listName;
  /** Sidebar width, dragged with the splitter and remembered. */
  protected readonly sideWidth = persistedWidth(SIDE_WIDTH_KEY, DEFAULT_SIDE_WIDTH);
  protected readonly defaultSideWidth = DEFAULT_SIDE_WIDTH;
  protected readonly sideMinWidth = SIDE_MIN_WIDTH;
  protected readonly mainMinWidth = MAIN_MIN_WIDTH;
  /** Contact panel width; 0 = default (sender 2/3, contact 1/3). */
  protected readonly contactWidth = persistedWidth(CONTACT_WIDTH_KEY, 0);
  protected readonly contactMinWidth = CONTACT_MIN_WIDTH;
  protected readonly senderMinWidth = SENDER_MIN_WIDTH;
  protected readonly avatarSize = AVATAR_SIZE;
  protected readonly largeAvatarSize = LARGE_AVATAR_SIZE;
  protected readonly mailTime = mailTime;

  protected readonly mode = signal<'mail' | 'senders' | 'drafts' | 'outbox' | 'trash'>('mail');
  protected readonly view = signal<MailView>('priority');
  protected readonly accountId = signal<string | null>(null);
  protected readonly query = signal('');
  /** Search filters (Filters panel next to the search). */
  protected readonly filters = signal<MailFilters>(EMPTY_FILTERS);
  protected readonly filterCount = computed(() => activeFilterCount(this.filters()));
  protected readonly emptyFilters = EMPTY_FILTERS;
  private readonly debouncedQuery = signal('');
  protected readonly senderFilter = signal<string | null>(null);
  protected readonly limit = signal(PAGE_SIZE);
  /** Open message: the `open` query parameter (browser Back returns to the list). */
  protected readonly selectedId = computed(() => this.open() ?? null);
  /** The open message was reached from the list: Back pops history instead of navigating. */
  private openedFromList = false;
  /** Remote images: Settings → Mail default, reset for each opened message. */
  protected readonly allowImages = linkedSignal({
    source: () => ({
      id: this.selectedId(),
      auto: this.settings.get('mail_auto_download_images'),
    }),
    computation: (source) => source.auto,
  });
  /** Messages whose Mail Preview the user switched off (original subject shown). */
  private readonly previewHidden = signal<ReadonlySet<string>>(new Set());
  /** Messages whose Mail Preview is being generated. */
  protected readonly previewing = signal<ReadonlySet<string>>(new Set());
  private previewPoll: ReturnType<typeof setTimeout> | null = null;
  protected readonly syncing = signal(false);
  protected readonly summarizing = signal(false);
  protected readonly digesting = signal(false);
  protected readonly digestText = signal<string | null>(null);
  /** Open compose dialog: new message, reply or forward. */
  protected readonly compose = signal<ComposeRequest | null>(null);
  /** Attachment shown in the preview dialog. */
  protected readonly attachmentPreview = signal<AttachmentRef | null>(null);
  protected readonly note = signal('');

  protected readonly accounts = resource({
    params: () => ({ version: this.sync.version('mail')() }),
    loader: () => this.mail.accounts(),
  });
  /** Accounts, empty while loading or on error (`value()` throws on error). */
  /** Accounts, kept while reloading so the layout never flashes. */
  protected readonly accountList = latestValue(this.accounts, []);
  protected readonly hasAccounts = computed(() => this.accountList().length > 0);
  /** Accounts known (loaded or failed): decides between the mailbox and "Add account". */
  protected readonly accountsSettled = computed(
    () => this.accounts.hasValue() || this.accounts.status() === 'error',
  );
  protected readonly counts = resource({
    params: () =>
      this.hasAccounts()
        ? { account: this.accountId(), version: this.sync.version('mail')() }
        : undefined,
    loader: ({ params }) => this.mail.counts(params.account),
  });
  protected readonly list = resource({
    params: () =>
      this.hasAccounts()
        ? {
            view: this.view(),
            accountId: this.accountId(),
            search: this.debouncedQuery(),
            sender: this.senderFilter(),
            filters: filterParams(this.filters()),
            limit: this.limit(),
            version: this.sync.version('mail')(),
          }
        : undefined,
    loader: ({ params }) => this.mail.messages(params),
  });
  protected readonly message = resource({
    params: () => {
      const id = this.selectedId();
      return id === null ? undefined : { id, version: this.sync.version('mail')() };
    },
    loader: ({ params }) => this.mail.message(params.id),
  });

  /** Unread count per view (empty until loaded or on error). */
  protected readonly unreadCounts = latestValue(this.counts, {});
  /** Listed messages (empty until loaded or on error). */
  protected readonly rows = latestValue(this.list, []);
  /** Open message, null when none, loading or failed. */
  private readonly loadedMessage = latestValue<MailDetail | null>(this.message, null);
  protected readonly openMessage = computed(() =>
    this.selectedId() === null ? null : this.loadedMessage(),
  );
  private readonly accountColors = computed(
    () => new Map(this.accountList().map((account) => [account.id, account.color])),
  );
  protected readonly accountOptions = computed(() => [
    { id: null, email: 'All accounts' },
    ...this.accountList(),
  ]);
  protected readonly currentView = computed(
    () => VIEW_META.find((meta) => meta.view === this.view()) ?? PRIORITY_VIEW,
  );
  protected readonly syncErrors = computed(() =>
    this.accountList().filter((account) => account.last_error !== null),
  );
  protected readonly noteSave = new AutosaveController<{ email: string; note: string }>(
    (value) => this.mail.saveSenderNote(value.email, value.note),
    inject(DestroyRef),
  );

  /** Load the sender note, mark opened mail read, sync on open and every few minutes. */
  constructor() {
    effect(() => {
      const message = this.openMessage() ?? undefined;
      untracked(() => {
        if (message?.id !== this.noteOwner) {
          this.noteOwner = message?.id ?? null;
          this.note.set(message?.sender.note ?? '');
        }
        if (message !== undefined && !message.is_read) {
          void this.mail.setState(message.id, { is_read: true });
        }
      });
    });
    effect(() => {
      const opened = this.open() !== undefined;
      untracked(() => {
        if (opened) {
          this.mode.set('mail');
        } else {
          this.openedFromList = false;
        }
      });
    });
    this.startAutoSync(inject(DestroyRef));
  }

  /**
   * Sync once accounts are known, then every few minutes; stop timers on destroy.
   *
   * @param destroyRef - Page lifetime.
   */
  private startAutoSync(destroyRef: DestroyRef): void {
    let firstLoad = true;
    effect(() => {
      if (this.hasAccounts() && firstLoad) {
        firstLoad = false;
        untracked(() => void this.syncNow(true));
      }
    });
    const timer = setInterval(() => {
      if (this.hasAccounts()) {
        void this.syncNow(true);
      }
    }, AUTO_SYNC_MS);
    destroyRef.onDestroy(() => {
      clearInterval(timer);
      if (this.previewPoll !== null) {
        clearTimeout(this.previewPoll);
      }
    });
  }

  /**
   * Whether a message is flagged for today's Activity feed (resets at Settings → Mail → Activity reset time).
   *
   * @param mail - Message.
   * @returns True when flagged since the last reset.
   */
  protected isActivity(mail: MailSummary): boolean {
    return isActivityToday(mail, this.settings.get('mail_activity_reset_time'));
  }

  /**
   * Switch view (clears the sender filter and selection).
   *
   * @param view - View.
   */
  protected openView(view: MailView): void {
    this.mode.set('mail');
    this.view.set(view);
    this.senderFilter.set(null);
    this.limit.set(PAGE_SIZE);
    this.closeMessage();
  }

  /**
   * Debounce the search.
   *
   * @param value - Text.
   */
  protected search(value: string): void {
    this.query.set(value);
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.debouncedQuery.set(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Load one more page. */
  protected more(): void {
    this.limit.update((limit) => limit + PAGE_SIZE);
  }

  /**
   * Open an attachment: preview it in the page, or download it when it has no preview.
   *
   * @param mail - Message.
   * @param index - Attachment position.
   */
  protected openAttachment(mail: MailDetail, index: number): void {
    const filename = mail.attachments[index] ?? '';
    if (previewType(filename) === null) {
      triggerDownload(this.mail.attachmentUrl(mail.id, index), filename);
      return;
    }
    this.attachmentPreview.set({ messageId: mail.id, index, filename });
  }

  /**
   * Icon of an attachment chip.
   *
   * @param filename - File name.
   * @returns PrimeIcons class (download icon when it has no preview).
   */
  protected attachmentIcon(filename: string): string {
    const kind = previewType(filename)?.kind;
    return kind === undefined ? 'pi pi-download' : ATTACHMENT_ICONS[kind];
  }

  /**
   * Tooltip of an attachment chip.
   *
   * @param filename - File name.
   * @returns What a click does.
   */
  protected attachmentHint(filename: string): string {
    return `${previewType(filename) === null ? 'Download' : 'Preview'} ${filename}`;
  }

  /**
   * Show every message of one sender.
   *
   * @param email - Address.
   */
  protected filterSender(email: string): void {
    this.mode.set('mail');
    this.view.set('all');
    this.senderFilter.set(email);
    this.closeMessage();
  }

  /**
   * Fetch new mail.
   *
   * @param quiet - Only report errors.
   */
  protected async syncNow(quiet = false): Promise<void> {
    if (this.syncing()) {
      return;
    }
    this.syncing.set(true);
    try {
      const results = await this.mail.syncNow(this.accountId());
      const fetched = results.reduce((total, result) => total + result.fetched, 0);
      const failed = results.filter((result) => result.error !== null);
      if (failed.length > 0) {
        this.notify.error('Mail sync failed', failed.map((result) => result.error).join('\n'));
      } else if (!quiet || fetched > 0) {
        this.notify.success(fetched === 0 ? 'No new mail' : `${String(fetched)} new messages`);
      }
      if (fetched > 0 && this.settings.get('mail_auto_preview')) {
        this.watchPreviews();
      }
    } finally {
      this.syncing.set(false);
    }
  }

  /**
   * Whether a message shows its Mail Preview (on by default once generated).
   *
   * @param id - Message id.
   * @returns True when the AI preview replaces the subject.
   */
  protected showsPreview(id: string): boolean {
    return !this.previewHidden().has(id);
  }

  /**
   * Switch a message between its Mail Preview and its original subject.
   *
   * @param id - Message id.
   * @param event - Click (kept from opening the message).
   */
  protected togglePreview(id: string, event: Event): void {
    event.stopPropagation();
    this.previewHidden.update((hidden) => toggled(hidden, id));
  }

  /**
   * Queue Mail Previews and refresh until they are written.
   *
   * @param ids - Message ids.
   */
  protected async generatePreviews(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      this.notify.info('Every listed mail already has a Mail Preview');
      return;
    }
    this.previewing.update((current) => new Set([...current, ...ids]));
    await this.mail.queuePreviews(ids);
    this.watchPreviews();
  }

  /** Mail Preview of the listed received mail that has none yet. */
  protected previewList(): void {
    const ids = this.rows()
      .filter((row) => row.mailbox === 'inbox' && row.preview_title === null)
      .map((row) => row.id);
    void this.generatePreviews(ids);
  }

  /** Poll the Mail Preview queue, refreshing the mail as previews land. */
  private watchPreviews(): void {
    if (this.previewPoll !== null) {
      return;
    }
    const poll = async (): Promise<void> => {
      const pending = await this.mail.pendingPreviews();
      this.sync.invalidate('mail');
      if (pending === 0) {
        this.previewPoll = null;
        this.previewing.set(new Set());
        return;
      }
      this.previewPoll = setTimeout(() => void poll(), PREVIEW_POLL_MS);
    };
    this.previewPoll = setTimeout(() => void poll(), PREVIEW_POLL_MS);
  }

  /** AI briefing of the unread mail. */
  protected async digest(): Promise<void> {
    this.digesting.set(true);
    try {
      this.digestText.set(await this.mail.digest(this.accountId()));
    } finally {
      this.digesting.set(false);
    }
  }

  /** Mark the whole view read. */
  protected async markAllRead(): Promise<void> {
    const marked = await this.mail.markAllRead(this.view(), this.accountId());
    this.notify.info(`${String(marked)} marked read`);
  }

  /**
   * AI triage of the open message.
   *
   * @param message - Message.
   */
  protected async summarize(message: MailDetail): Promise<void> {
    this.summarizing.set(true);
    try {
      await this.mail.summarize(message.id);
    } finally {
      this.summarizing.set(false);
    }
  }

  /**
   * Toggle read or flagged; reports server sync errors.
   *
   * @param message - Message.
   * @param state - New state.
   */
  protected async setState(message: MailDetail, state: MailStateChange): Promise<void> {
    const error = await this.mail.setState(message.id, state);
    if (state.is_read === false) {
      this.backToList();
    }
    if (error !== null) {
      this.notify.warn('Changed here only', error);
    }
  }

  /**
   * Move the open message to the Trash and go back to the list.
   *
   * @param message - Message.
   */
  protected async deleteMessage(message: MailDetail): Promise<void> {
    await this.mail.deleteMessage(message.id);
    this.backToList();
    this.notify.info('Moved to Trash', message.subject || '(no subject)');
  }

  /**
   * Change how a sender is treated.
   *
   * @param email - Address.
   * @param flag - New flag.
   */
  protected async setFlag(email: string, flag: SenderFlag): Promise<void> {
    await this.mail.updateSender(email, { flag });
    const label = FLAG_META.find((meta) => meta.flag === flag)?.label ?? flag;
    this.notify.success(`${email} → ${label}`);
  }

  /**
   * Save the note kept about a sender (used by AI reply drafts).
   *
   * @param email - Address.
   * @param note - Note.
   */
  protected editNote(email: string, note: string): void {
    this.note.set(note);
    this.noteSave.schedule({ email, note });
  }

  /**
   * Open the sender in People (creates the contact when needed).
   *
   * @param email - Address.
   */
  protected async openContact(email: string): Promise<void> {
    const contactId = await this.mail.linkContact(email);
    await this.router.navigate(['/people', contactId]);
  }

  /**
   * Color of an account.
   *
   * @param accountId - Account id.
   * @returns `#rrggbb`, transparent when unknown.
   */
  protected colorOf(accountId: string): string {
    return this.accountColors().get(accountId) ?? 'transparent';
  }

  /** Escape: back to the list (ignored while a dialog is open). */
  protected onEscape(): void {
    if (this.selectedId() !== null && this.compose() === null) {
      this.backToList();
    }
  }

  /**
   * Open a message: a new history entry, so browser Back returns to the list.
   *
   * @param id - Message id.
   */
  protected openMail(id: string): void {
    this.openedFromList = true;
    void this.router.navigate([], { queryParams: { open: id }, queryParamsHandling: 'merge' });
  }

  /** Back to the list: pop history when the mail came from the list, else drop `open`. */
  protected backToList(): void {
    if (this.openedFromList) {
      this.openedFromList = false;
      this.location.back();
      return;
    }
    this.closeMessage();
  }

  /**
   * Grid columns of the sender | handle | contact row (sender 2/3 until dragged).
   *
   * @param withContact - Whether the contact panel is shown.
   * @returns CSS grid-template-columns.
   */
  protected peopleColumns(withContact: boolean): string {
    if (!withContact) {
      return 'minmax(0, 1fr)';
    }
    const width = this.contactWidth();
    return width > 0
      ? `minmax(0, 1fr) auto ${String(width)}px`
      : 'minmax(0, 2fr) auto minmax(0, 1fr)';
  }

  /** Drop the `open` parameter without a history entry (view changes, deep links). */
  private closeMessage(): void {
    this.openedFromList = false;
    if (this.open() !== undefined) {
      void this.router.navigate([], {
        queryParams: { open: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  /**
   * Initials of a sender.
   *
   * @param name - Name or address.
   * @returns Up to two letters.
   */
  protected initials(name: string): string {
    const words = name
      .replace(/@.*/, '')
      .split(/[\s._-]+/)
      .filter(Boolean);
    return words
      .slice(0, INITIALS)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  }

  /**
   * Avatar colors of a sender.
   *
   * @param name - Name or address.
   * @returns Background and text colors.
   */
  protected avatarColors(name: string): { background: string; color: string } {
    const background = colorForName(name);
    return { background, color: readableTextColor(background) };
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { PopoverModule } from 'primeng/popover';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import type { CalendarRecord, ChatCalendar, ChatMessage } from '@domain/contracts';
import { fileNameOf, isSharedFilePath } from '@domain/files';
import { parsePresets, toChatCalendar } from '@domain/mappers';
import { ChatStream } from '../../core/chat/chat-stream';
import { ChatApi } from '../../core/chat/chat.api';
import { PeekService } from '../../core/files/peek.service';
import { NotifyService } from '../../core/notify/notify.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { FilePickerDialogComponent } from '../../shared/files/file-picker-dialog.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { CalendarPickerComponent } from './calendar-picker.component';
import { PresetsDialogComponent } from './presets-dialog.component';

const TITLE_LENGTH = 60;

/** Assistant: chat sessions grounded on attached files, time entries and (optionally) RAG. */
@Component({
  selector: 'ac-assistant-page',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    PopoverModule,
    TextareaModule,
    TooltipModule,
    CalendarPickerComponent,
    FilePickerDialogComponent,
    MarkdownViewComponent,
    PresetsDialogComponent,
  ],
  providers: [ChatStream],
  templateUrl: './assistant.page.html',
  styleUrl: './assistant.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPage {
  private readonly chat = inject(ChatApi);
  private readonly settings = inject(SettingsStore);
  private readonly sync = inject(DataSync);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  protected readonly peek = inject(PeekService);
  protected readonly stream = inject(ChatStream);

  /** Query parameter: session id (one route, so the page survives session switches). */
  readonly session = input<string | undefined>(undefined);
  /** Query parameter: files to attach (from the viewer or a selection). */
  readonly attach = input<string | string[] | undefined>(undefined);

  protected readonly draft = signal('');
  protected readonly files = signal<readonly string[]>([]);
  protected readonly calendars = signal<readonly ChatCalendar[]>([]);
  protected readonly sending = signal(false);
  protected readonly pickingFiles = signal(false);
  protected readonly pickingCalendars = signal(false);
  protected readonly managingPresets = signal(false);
  protected readonly editing = signal<{ title: string; description: string } | null>(null);
  protected readonly ragEnabled = linkedSignal(
    () => this.settings.values()['chat_rag_enabled_default'] === true,
  );
  protected readonly withDescription = signal(false);

  protected readonly sessions = resource({
    params: () => this.sync.version('chat')(),
    loader: () => this.chat.sessions(),
  });
  protected readonly id = computed(() => this.session());
  protected readonly messages = resource({
    params: () => {
      const id = this.id();
      return id === undefined ? undefined : { id, version: this.sync.version('chat')() };
    },
    loader: ({ params }) => this.chat.messages(params.id),
  });
  protected readonly canRetry = computed(() => {
    const last = (this.messages.value() ?? []).at(-1);
    return (
      last !== undefined &&
      (last.role === 'error' || last.role === 'cancelled') &&
      !this.stream.running()
    );
  });
  protected readonly current = computed(
    () => (this.sessions.value() ?? []).find((session) => session.id === this.id()) ?? null,
  );
  protected readonly presets = computed(() => parsePresets(this.settings.values()['chat_presets']));
  protected readonly userDescription = computed(() => {
    const value = this.settings.values()['chat_user_description'];
    return typeof value === 'string' ? value : '';
  });

  /** Restore attachments, follow running generations, accept attachments from the URL. */
  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.stream.stop();
        if (id !== undefined) {
          this.stream.follow(id, () => {
            this.sync.invalidate('chat');
          });
        }
      });
    });
    effect(() => {
      const messages = this.messages.value();
      untracked(() => {
        this.restoreAttachments(messages ?? []);
      });
    });
    effect(() => {
      const attach = this.attach();
      untracked(() => {
        const paths = (
          Array.isArray(attach) ? attach : attach === undefined ? [] : [attach]
        ).filter(isSharedFilePath);
        if (paths.length > 0) {
          this.files.update((current) => [...new Set([...current, ...paths])]);
        }
      });
    });
  }

  /**
   * File name of a path.
   *
   * @param path - Path.
   * @returns Name.
   */
  protected nameOf(path: string): string {
    return fileNameOf(path);
  }

  /** Send the draft (creates a session on first message). */
  protected async send(): Promise<void> {
    const content = this.draft().trim();
    if (content === '' || this.sending() || this.stream.running()) {
      return;
    }
    this.sending.set(true);
    try {
      const id = this.id() ?? (await this.newSession(content));
      await this.chat.send(id, {
        content,
        files: this.files(),
        calendars: this.calendars(),
        rag_enabled: this.ragEnabled(),
        ...(this.withDescription() && this.userDescription() !== ''
          ? { user_description: this.userDescription() }
          : {}),
      });
      this.draft.set('');
      this.sync.invalidate('chat');
      this.stream.follow(
        id,
        () => {
          this.sync.invalidate('chat');
        },
        true,
      );
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Send on Enter (Shift+Enter adds a line).
   *
   * @param event - Key event.
   */
  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  /** Ask the last question again (after an error or a stop). */
  protected retry(): void {
    const last = [...(this.messages.value() ?? [])]
      .reverse()
      .find((message) => message.role === 'user');
    if (last !== undefined) {
      this.draft.set(last.content);
      void this.send();
    }
  }

  /** Stop the generation. */
  protected async stop(): Promise<void> {
    const id = this.id();
    if (id !== undefined) {
      await this.chat.cancel(id);
    }
  }

  /**
   * Insert a preset into the composer.
   *
   * @param message - Preset text.
   */
  protected usePreset(message: string): void {
    this.draft.set(message);
  }

  /**
   * Add picked files.
   *
   * @param paths - Files.
   */
  protected addFiles(paths: readonly string[]): void {
    this.files.update((current) => [...new Set([...current, ...paths])]);
  }

  /**
   * Add picked time entries.
   *
   * @param records - Records.
   */
  protected addCalendars(records: readonly CalendarRecord[]): void {
    const key = (calendar: ChatCalendar): string =>
      `${calendar.date}|${calendar.title}|${calendar.project}`;
    const known = new Set(this.calendars().map(key));
    this.calendars.update((current) => [
      ...current,
      ...records.map(toChatCalendar).filter((calendar) => !known.has(key(calendar))),
    ]);
  }

  /**
   * Copy a message.
   *
   * @param message - Message.
   */
  protected async copy(message: ChatMessage): Promise<void> {
    await navigator.clipboard.writeText(message.content);
    this.notify.info('Copied.');
  }

  /** Save the session title/description. */
  protected async saveSession(): Promise<void> {
    const id = this.id();
    const draft = this.editing();
    if (id !== undefined && draft !== null && draft.title.trim() !== '') {
      await this.chat.edit(id, draft.title.trim(), draft.description);
      this.editing.set(null);
    }
  }

  /** Confirm and delete the session. */
  protected removeSession(): void {
    const id = this.id();
    if (id === undefined) {
      return;
    }
    this.confirm.confirm({
      header: 'Delete conversation',
      message: 'Delete this conversation and its messages?',
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () =>
        void this.chat.delete(id).then(() => {
          this.newConversation();
        }),
    });
  }

  /** Start a fresh conversation. */
  protected newConversation(): void {
    this.files.set([]);
    this.calendars.set([]);
    this.draft.set('');
    void this.router.navigate(['/assistant'], { queryParams: { session: null, attach: null } });
  }

  /**
   * Open a session.
   *
   * @param id - Session id.
   */
  protected open(id: string): void {
    this.files.set([]);
    this.calendars.set([]);
    void this.router.navigate(['/assistant'], { queryParams: { session: id, attach: null } });
  }

  /**
   * Create a session titled after the first message and open it.
   *
   * @param content - First message.
   * @returns Session id.
   */
  private async newSession(content: string): Promise<string> {
    const title =
      content.length > TITLE_LENGTH ? `${content.slice(0, TITLE_LENGTH - 1)}…` : content;
    const id = await this.chat.create(title);
    await this.router.navigate(['/assistant'], { queryParams: { session: id, attach: null } });
    return id;
  }

  /**
   * Restore manual attachments of the last user message (like the Streamlit front).
   *
   * @param messages - Messages of the session.
   */
  private restoreAttachments(messages: readonly ChatMessage[]): void {
    const last = [...messages].reverse().find((message) => message.role === 'user');
    if (last === undefined) {
      return;
    }
    if (this.files().length === 0) {
      this.files.set(
        last.files.filter((file) => file.source === 'manual').map((file) => file.path),
      );
    }
    if (this.calendars().length === 0) {
      this.calendars.set(last.calendars);
    }
  }
}

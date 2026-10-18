import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { TabsModule } from 'primeng/tabs';
import { CaptureService, NO_DEFAULTS } from '../../core/capture/capture.service';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { type ContactLink, ContactsApi } from '../../core/people/contacts.api';
import { AutosaveController } from '../../core/state/autosave';
import { DataSync } from '../../core/state/data-sync.service';
import { FileCollectionComponent } from '../../shared/files/file-collection.component';
import { FilePickerDialogComponent } from '../../shared/files/file-picker-dialog.component';
import { AiTextareaComponent } from '../../shared/ui/ai-textarea.component';
import { ContactAvatarComponent } from '../../shared/ui/contact-avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SaveStatusComponent } from '../../shared/ui/save-status.component';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import { ContactDialogComponent } from './contact-dialog.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';

const SEARCH_DEBOUNCE_MS = 250;
const AVATAR_SIZE = 72;
const NOTE_ROWS = 10;

/** People: searchable list and detail (photo, links, notes, files). */
@Component({
  selector: 'ac-people-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MultiSelectModule,
    TabsModule,
    AiTextareaComponent,
    ContactAvatarComponent,
    ContactDialogComponent,
    EmptyStateComponent,
    FileCollectionComponent,
    FilePickerDialogComponent,
    SaveStatusComponent,
    TagChipComponent,
    MarkdownViewComponent,
  ],
  templateUrl: './people.page.html',
  styleUrl: './people.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeoplePage {
  private readonly contacts = inject(ContactsApi);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmationService);
  private readonly capture = inject(CaptureService);
  protected readonly catalog = inject(CatalogStore);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Route parameter: selected contact. */
  readonly id = input<string | undefined>(undefined);
  /** Query parameter: `1` opens the create dialog. */
  readonly new = input<string | undefined>(undefined);

  protected readonly query = signal('');
  private readonly debouncedQuery = signal('');
  protected readonly dialog = signal<'create' | 'edit' | null>(null);
  protected readonly picking = signal(false);
  protected readonly notes = signal('');
  protected readonly photoVersion = signal(0);
  protected readonly avatarSize = AVATAR_SIZE;
  protected readonly noteRows = NOTE_ROWS;

  protected readonly list = resource({
    params: () => ({ query: this.debouncedQuery(), version: this.sync.version('contacts')() }),
    loader: ({ params }) => this.contacts.list(params.query),
  });
  protected readonly contact = resource({
    params: () => {
      const id = this.id();
      return id === undefined
        ? undefined
        : { id, version: this.sync.version('contacts')() + this.sync.version('files')() };
    },
    loader: ({ params }) => this.contacts.get(params.id),
  });
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly tagOptions = computed(() => this.catalog.tagList().map((tag) => tag.name));
  protected readonly notesSave = new AutosaveController<{ id: string; notes: string }>(
    (value) => this.contacts.saveNotes(value.id, value.notes),
    inject(DestroyRef),
  );

  /** Load notes and preselect the contact for new captures. */
  constructor() {
    effect(() => {
      const contact = this.contact.value();
      untracked(() => {
        this.notes.set(contact?.notes ?? '');
        this.capture.setDefaults(
          contact === undefined ? NO_DEFAULTS : { ...NO_DEFAULTS, contacts: [contact.id] },
        );
      });
    });
    effect(() => {
      if (this.new() === '1') {
        untracked(() => {
          this.dialog.set('create');
          void this.router.navigate([], {
            queryParams: { new: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        });
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.capture.setDefaults(NO_DEFAULTS);
    });
  }

  /**
   * Debounced search.
   *
   * @param text - Query.
   */
  protected search(text: string): void {
    this.query.set(text);
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.debouncedQuery.set(text);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Role and company line.
   *
   * @param role - Role.
   * @param company - Company.
   * @returns Subtitle.
   */
  protected subtitle(role: string | null, company: string | null): string {
    return [role, company].filter((part) => part !== null && part !== '').join(' · ');
  }

  /**
   * Record a notes edit.
   *
   * @param notes - Notes.
   */
  protected editNotes(notes: string): void {
    const contact = this.contact.value();
    this.notes.set(notes);
    if (contact !== undefined) {
      this.notesSave.schedule({ id: contact.id, notes });
    }
  }

  /**
   * Upload a new photo.
   *
   * @param event - File input change.
   */
  protected async uploadPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const contact = this.contact.value();
    if (file !== undefined && contact !== undefined) {
      await this.contacts.uploadPhoto(contact.id, file);
      this.photoVersion.update((value) => value + 1);
    }
    input.value = '';
  }

  /**
   * Apply a new set of projects or tags.
   *
   * @param kind - Link kind.
   * @param names - New names.
   */
  protected async setLinks(
    kind: Extract<ContactLink, 'project' | 'tag'>,
    names: readonly string[],
  ): Promise<void> {
    const contact = this.contact.value();
    if (contact === undefined) {
      return;
    }
    const current = kind === 'project' ? contact.projects : contact.tags;
    for (const name of names.filter((value) => !current.includes(value))) {
      await this.contacts.setLink(contact.id, kind, name, true);
    }
    for (const name of current.filter((value) => !names.includes(value))) {
      await this.contacts.setLink(contact.id, kind, name, false);
    }
  }

  /**
   * Link picked files.
   *
   * @param paths - Files.
   */
  protected async linkFiles(paths: readonly string[]): Promise<void> {
    const contact = this.contact.value();
    for (const path of contact === undefined ? [] : paths) {
      await this.contacts.setLink(contact?.id ?? '', 'file', path, true);
    }
  }

  /**
   * Select a contact (after create).
   *
   * @param id - Contact id.
   */
  protected select(id: string): void {
    void this.router.navigate(['/people', id]);
  }

  /** Confirm and delete. */
  protected remove(): void {
    const contact = this.contact.value();
    if (contact === undefined) {
      return;
    }
    this.confirm.confirm({
      header: 'Delete contact',
      message: `Delete ${contact.name}? Their links to files, projects and tags are removed.`,
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () =>
        void this.contacts.delete(contact.id).then(() => this.router.navigate(['/people'])),
    });
  }
}

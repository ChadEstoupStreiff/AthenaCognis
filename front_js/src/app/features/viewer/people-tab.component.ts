import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import type { ContactSummary } from '@domain/contracts';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { DataSync } from '../../core/state/data-sync.service';
import { ContactAvatarComponent } from '../../shared/ui/contact-avatar.component';

/** People linked to a file. */
@Component({
  selector: 'ac-people-tab',
  imports: [FormsModule, RouterLink, ButtonModule, SelectModule, ContactAvatarComponent],
  template: `
    <section class="block">
      <h3>People</h3>
      @for (contact of linked.value() ?? []; track contact.id) {
        <div class="item">
          <ac-contact-avatar [contactId]="contact.id" [name]="contact.name" />
          <div class="item-main">
            <a [routerLink]="['/people', contact.id]">{{ contact.name }}</a>
            <small>{{ subtitle(contact) }}</small>
          </div>
          <p-button
            icon="pi pi-times"
            [text]="true"
            size="small"
            severity="secondary"
            ariaLabel="Unlink"
            (onClick)="unlink(contact.id)"
          />
        </div>
      } @empty {
        <p class="empty">Nobody linked yet.</p>
      }
      <p-select
        [options]="candidates()"
        optionLabel="name"
        optionValue="id"
        [filter]="true"
        placeholder="Link someone…"
        [fluid]="true"
        appendTo="body"
        [ngModel]="null"
        (ngModelChange)="link($event)"
        ariaLabel="Link a contact"
      />
    </section>
  `,
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeopleTabComponent {
  private readonly details = inject(FileDetailsApi);
  private readonly catalog = inject(CatalogStore);
  private readonly sync = inject(DataSync);

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly linked = resource({
    params: () => ({ path: this.path(), version: this.sync.version('contacts')() }),
    loader: ({ params }) => this.details.contactsOf(params.path),
  });

  protected readonly candidates = computed(() => {
    const linkedIds = new Set((this.linked.value() ?? []).map((contact) => contact.id));
    return this.catalog.contactList().filter((contact) => !linkedIds.has(contact.id));
  });

  /**
   * Role and company line.
   *
   * @param contact - Contact.
   * @returns Subtitle.
   */
  protected subtitle(contact: ContactSummary): string {
    return [contact.role, contact.company]
      .filter((part) => part !== null && part !== '')
      .join(' · ');
  }

  /**
   * Link a contact.
   *
   * @param contactId - Contact id (null when the select is cleared).
   */
  protected async link(contactId: string | null): Promise<void> {
    if (contactId !== null) {
      await this.details.setContact(contactId, this.path(), true);
    }
  }

  /**
   * Unlink a contact.
   *
   * @param contactId - Contact id.
   */
  protected async unlink(contactId: string): Promise<void> {
    await this.details.setContact(contactId, this.path(), false);
  }
}

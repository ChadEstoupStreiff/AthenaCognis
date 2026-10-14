import { inject, Injectable } from '@angular/core';
import type { ContactDetail, ContactSummary, ContactUpsert } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Contact link kinds and their query parameter. */
export type ContactLink = 'file' | 'tag' | 'project';

/** People. */
@Injectable({ providedIn: 'root' })
export class ContactsApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Search contacts.
   *
   * @param search - Text (name, email, company, role, notes).
   * @returns Contacts, sorted by name.
   */
  list(search: string): Promise<ContactSummary[]> {
    return this.api.get<ContactSummary[]>(backendUrl('/contacts'), {
      params: { search: search.trim() === '' ? null : search },
    });
  }

  /**
   * One contact with links.
   *
   * @param id - Contact id.
   * @returns The contact.
   */
  get(id: string): Promise<ContactDetail> {
    return this.api.get<ContactDetail>(backendUrl(`/contacts/${encodeURIComponent(id)}`));
  }

  /**
   * Create a contact.
   *
   * @param contact - Contact.
   * @returns New id.
   */
  async create(contact: ContactUpsert): Promise<string> {
    const result = await this.api.post<{ id: string }>(backendUrl('/contacts'), contact);
    this.sync.invalidate('contacts');
    return result.id;
  }

  /**
   * Replace a contact (links included).
   *
   * @param id - Contact id.
   * @param contact - Contact.
   */
  async update(id: string, contact: ContactUpsert): Promise<void> {
    await this.api.put(backendUrl(`/contacts/${encodeURIComponent(id)}`), contact);
    this.sync.invalidate('contacts');
  }

  /**
   * Delete a contact.
   *
   * @param id - Contact id.
   */
  async delete(id: string): Promise<void> {
    await this.api.delete(backendUrl(`/contacts/${encodeURIComponent(id)}`));
    this.sync.invalidate('contacts');
  }

  /**
   * Save contact notes.
   *
   * @param id - Contact id.
   * @param notes - Notes.
   */
  async saveNotes(id: string, notes: string): Promise<void> {
    await this.api.post(backendUrl(`/contact/${encodeURIComponent(id)}/notes`), undefined, {
      params: { notes },
      silent: true,
    });
  }

  /**
   * Upload a photo (stored as a 256 px JPEG).
   *
   * @param id - Contact id.
   * @param photo - Image.
   */
  async uploadPhoto(id: string, photo: File): Promise<void> {
    const form = new FormData();
    form.append('photo', photo, photo.name);
    await this.api.post(backendUrl(`/contact/${encodeURIComponent(id)}/photo`), form);
  }

  /**
   * Link or unlink a file, tag or project.
   *
   * @param id - Contact id.
   * @param kind - Link kind.
   * @param value - Path or name.
   * @param linked - Target state.
   */
  async setLink(id: string, kind: ContactLink, value: string, linked: boolean): Promise<void> {
    const url = backendUrl(`/contact/${encodeURIComponent(id)}/${kind}`);
    const options = { params: { [kind]: value } };
    await (linked ? this.api.post(url, undefined, options) : this.api.delete(url, options));
    this.sync.invalidate('contacts', 'files');
  }
}

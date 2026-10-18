import { inject, Injectable } from '@angular/core';
import type {
  BackendLinkTuple,
  BackendProject,
  ContactSummary,
  FileLink,
  FileNote,
  JobService,
  JobTask,
  LinkSuggestion,
  OcrRecord,
  SummaryRecord,
  Tag,
  TranscriptionRecord,
} from '@domain/contracts';
import { encodeFileSegment } from '@domain/files';
import { toFileLinks, toSummaryRecord } from '@domain/mappers';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Services whose results can be fetched per file. */
type ResultService = 'ocr' | 'transcription' | 'summarize';

/** Per-file details: relations, pins, notes, links, AI results and job history. */
@Injectable({ providedIn: 'root' })
export class FileDetailsApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * Projects of a file.
   *
   * @param path - Shared path.
   * @returns Projects.
   */
  projectsOf(path: string): Promise<BackendProject[]> {
    return this.api.get<BackendProject[]>(backendUrl(`/projects_of/${encodeFileSegment(path)}`));
  }

  /**
   * Tags of a file.
   *
   * @param path - Shared path.
   * @returns Tags.
   */
  tagsOf(path: string): Promise<Tag[]> {
    return this.api.get<Tag[]>(backendUrl(`/tags_of/${encodeFileSegment(path)}`));
  }

  /**
   * Contacts linked to a file.
   *
   * @param path - Shared path.
   * @returns Contacts.
   */
  contactsOf(path: string): Promise<ContactSummary[]> {
    return this.api.get<ContactSummary[]>(backendUrl(`/contacts_of/${encodeFileSegment(path)}`));
  }

  /**
   * Link or unlink a contact.
   *
   * @param contactId - Contact id.
   * @param path - Shared path.
   * @param linked - Target state.
   */
  async setContact(contactId: string, path: string, linked: boolean): Promise<void> {
    const url = backendUrl(`/contact/${contactId}/file`);
    await (linked
      ? this.api.post(url, undefined, { params: { file: path } })
      : this.api.delete(url, { params: { file: path } }));
    this.sync.invalidate('contacts', 'files');
  }

  /**
   * Whether a file is pinned.
   *
   * @param path - Shared path.
   * @returns Pin state.
   */
  isPinned(path: string): Promise<boolean> {
    return this.api.get<boolean>(backendUrl('/pinned/is_pinned'), { params: { file: path } });
  }

  /**
   * Pin or unpin a file.
   *
   * @param path - Shared path.
   * @param pinned - Target state.
   */
  async setPinned(path: string, pinned: boolean): Promise<void> {
    const options = { params: { file: path } };
    await (pinned
      ? this.api.post(backendUrl('/pinned'), undefined, options)
      : this.api.delete(backendUrl('/pinned'), options));
    this.sync.invalidate('pinned');
  }

  /**
   * Record a visit (feeds "recently opened").
   *
   * @param path - Shared path.
   */
  async recordOpened(path: string): Promise<void> {
    await this.api.post(backendUrl('/stockpile/recentopened'), undefined, {
      params: { file: path },
      silent: true,
    });
  }

  /**
   * Note attached to a file.
   *
   * @param path - Shared path.
   * @returns The note.
   */
  note(path: string): Promise<FileNote> {
    return this.api.get<FileNote>(backendUrl(`/notes/${encodeFileSegment(path)}`));
  }

  /**
   * Save the note of a file.
   *
   * @param path - Shared path.
   * @param note - Note text.
   */
  async saveNote(path: string, note: string): Promise<void> {
    await this.api.post(backendUrl(`/notes/${encodeFileSegment(path)}`), undefined, {
      params: { note },
      silent: true,
    });
  }

  /**
   * Links of a file, strongest first.
   *
   * @param path - Shared path.
   * @returns Links.
   */
  async links(path: string): Promise<FileLink[]> {
    return toFileLinks(
      await this.api.get<BackendLinkTuple[]>(backendUrl(`/links/list/${encodeFileSegment(path)}`)),
    );
  }

  /**
   * Create a link.
   *
   * @param fileA - First file.
   * @param fileB - Second file.
   * @param force - Strength.
   * @param comment - Optional comment.
   */
  async addLink(fileA: string, fileB: string, force: number, comment: string): Promise<void> {
    await this.api.post(backendUrl('/links/add'), undefined, {
      params: { fileA, fileB, force, comment },
    });
    this.sync.invalidate('links');
  }

  /**
   * Remove a link.
   *
   * @param fileA - First file.
   * @param fileB - Second file.
   */
  async removeLink(fileA: string, fileB: string): Promise<void> {
    await this.api.delete(backendUrl('/links/remove'), { params: { fileA, fileB } });
    this.sync.invalidate('links');
  }

  /**
   * Ask the AI for link suggestions (not saved).
   *
   * @param source - Source file.
   * @param targets - Candidate files.
   * @returns Suggestions.
   */
  suggestLinks(source: string, targets: readonly string[]): Promise<LinkSuggestion[]> {
    return this.api.post<LinkSuggestion[]>(backendUrl('/links/auto-find'), {
      source_file: source,
      target_files: targets,
    });
  }

  /**
   * OCR and caption of an image.
   *
   * @param path - Shared path.
   * @returns The record, or `null`.
   */
  ocr(path: string): Promise<OcrRecord | null> {
    return this.result<OcrRecord>('ocr', path);
  }

  /**
   * Summary of a file.
   *
   * @param path - Shared path.
   * @returns The record, or `null`.
   */
  async summary(path: string): Promise<SummaryRecord | null> {
    return toSummaryRecord(await this.result<SummaryRecord>('summarize', path));
  }

  /**
   * Transcription of audio/video.
   *
   * @param path - Shared path.
   * @returns The record, or `null`.
   */
  transcription(path: string): Promise<TranscriptionRecord | null> {
    return this.result<TranscriptionRecord>('transcription', path);
  }

  /**
   * Job history of a file on a service.
   *
   * @param service - Job service.
   * @param path - Shared path.
   * @returns Runs, newest first.
   */
  tasks(service: JobService, path: string): Promise<JobTask[]> {
    return this.api.get<JobTask[]>(backendUrl(`/${service}/tasks/${encodeFileSegment(path)}`));
  }

  /**
   * Queue a job for a file.
   *
   * @param service - Job service.
   * @param path - Shared path.
   */
  async ask(service: JobService, path: string): Promise<void> {
    const action = service === 'preview' ? 'preview/generate' : `${service}/ask`;
    await this.api.post(backendUrl(`/${action}/${encodeFileSegment(path)}`));
    this.sync.invalidate('jobs');
  }

  /**
   * Fetch one AI result.
   *
   * @param service - Result service.
   * @param path - Shared path.
   * @returns The record, or `null` when absent.
   */
  private result<T>(service: ResultService, path: string): Promise<T | null> {
    return this.api.get<T | null>(backendUrl(`/${service}/get/${encodeFileSegment(path)}`));
  }
}

import { inject, Injectable } from '@angular/core';
import type {
  BulkItemResult,
  ContactSummary,
  MoveRequest,
  NameDiff,
  RelationsPatch,
} from '@domain/contracts';
import { encodeFileSegment, parseSharedPath } from '@domain/files';
import { ApiClient, backendUrl } from '../api/api-client';
import { toApiProblem } from '../api/api-error';
import { RelationIndex } from './relation-index';

const RECENT_LISTS = ['recentadded', 'recentopened'] as const;
const RELATION_PREFIX = { projects: 'project', tags: 'tag' } as const;

/**
 * Stockpile key holding SOTA citation records of a file.
 *
 * @param path - Shared path.
 * @returns The key, or `null`.
 */
function citationKeyOf(path: string): string | null {
  const parts = parseSharedPath(path);
  return parts === null ? null : `sota_refs_${parts.date}_${parts.name}`;
}

/** Delete, move and bulk relation edits, plus the cleanups the backend skips. */
@Injectable({ providedIn: 'root' })
export class FileActions {
  private readonly api = inject(ApiClient);
  private readonly relations = inject(RelationIndex);

  /**
   * Delete files and their dangling references (recents, pin, contacts, citation records).
   *
   * @param paths - Files.
   * @returns One result per file.
   */
  async delete(paths: readonly string[]): Promise<BulkItemResult[]> {
    const results: BulkItemResult[] = [];
    for (const path of paths) {
      try {
        const contacts = await this.contactsOf(path);
        await this.api.delete(backendUrl(`/files/delete/${encodeFileSegment(path)}`), {
          silent: true,
        });
        await this.cleanupDeleted(path, contacts);
        results.push({ path, ok: true });
      } catch (error) {
        results.push({ path, ok: false, message: toApiProblem(error).message });
      }
    }
    this.relations.invalidate();
    return results;
  }

  /**
   * Move or rename a file, then repoint recents, pin, contacts and citation records.
   *
   * @param request - Move request.
   * @returns The new path.
   */
  async move(request: MoveRequest): Promise<string> {
    const contacts = await this.contactsOf(request.path);
    const pinned =
      (await this.relations.relationsOf([request.path]))[request.path]?.pinned === true;
    const newPath = await this.api.post<string>(
      backendUrl(`/files/move/${encodeFileSegment(request.path)}`),
      undefined,
      {
        params: { subfolder: request.folder, date: request.date, name: request.name },
      },
    );
    await this.forgetRecent(request.path);
    if (pinned) {
      await this.quiet(
        this.api.delete(backendUrl('/pinned'), { params: { file: request.path }, silent: true }),
      );
      await this.quiet(
        this.api.post(backendUrl('/pinned'), undefined, {
          params: { file: newPath },
          silent: true,
        }),
      );
    }
    for (const contact of contacts) {
      await this.setContactFile(contact.id, request.path, false);
      await this.setContactFile(contact.id, newPath, true);
    }
    await this.renameCitationRecord(request.path, newPath);
    this.relations.invalidate();
    return newPath;
  }

  /**
   * Add/remove projects and tags on several files (only effective changes are sent).
   *
   * @param patch - Bulk edit.
   * @returns One result per file.
   */
  async patchRelations(patch: RelationsPatch): Promise<BulkItemResult[]> {
    const current = await this.relations.relationsOf(patch.paths);
    const results: BulkItemResult[] = [];
    for (const path of patch.paths) {
      try {
        await this.applyDiff(path, 'projects', patch.projects, current[path]?.projects ?? []);
        await this.applyDiff(path, 'tags', patch.tags, current[path]?.tags ?? []);
        results.push({ path, ok: true });
      } catch (error) {
        results.push({ path, ok: false, message: toApiProblem(error).message });
      }
    }
    this.relations.invalidate();
    return results;
  }

  /**
   * Apply one relation diff to a file.
   *
   * @param path - File.
   * @param kind - Projects or tags.
   * @param diff - Names to add/remove.
   * @param existing - Names already linked.
   */
  private async applyDiff(
    path: string,
    kind: keyof typeof RELATION_PREFIX,
    diff: NameDiff | undefined,
    existing: readonly string[],
  ): Promise<void> {
    const prefix = RELATION_PREFIX[kind];
    const options = { params: { file: path }, silent: true };
    for (const name of diff?.add.filter((value) => !existing.includes(value)) ?? []) {
      await this.api.post(
        backendUrl(`/${prefix}/${encodeURIComponent(name)}/file`),
        undefined,
        options,
      );
    }
    for (const name of diff?.remove.filter((value) => existing.includes(value)) ?? []) {
      await this.api.delete(backendUrl(`/${prefix}/${encodeURIComponent(name)}/file`), options);
    }
  }

  /**
   * Contacts linked to a file (empty when the lookup fails).
   *
   * @param path - File.
   * @returns Contacts.
   */
  private async contactsOf(path: string): Promise<ContactSummary[]> {
    return (
      (await this.quiet(
        this.api.get<ContactSummary[]>(backendUrl(`/contacts_of/${encodeFileSegment(path)}`), {
          silent: true,
        }),
      )) ?? []
    );
  }

  /**
   * Remove references the backend keeps after a delete.
   *
   * @param path - Deleted file.
   * @param contacts - Contacts that were linked.
   */
  private async cleanupDeleted(path: string, contacts: readonly ContactSummary[]): Promise<void> {
    await this.forgetRecent(path);
    await this.quiet(
      this.api.delete(backendUrl('/pinned'), { params: { file: path }, silent: true }),
    );
    for (const contact of contacts) {
      await this.setContactFile(contact.id, path, false);
    }
    const key = citationKeyOf(path);
    if (key !== null) {
      await this.quiet(
        this.api.delete(backendUrl(`/stockpile/delete/${encodeURIComponent(key)}`), {
          silent: true,
        }),
      );
    }
  }

  /**
   * Drop a path from the recently added/opened lists.
   *
   * @param path - File.
   */
  private async forgetRecent(path: string): Promise<void> {
    for (const list of RECENT_LISTS) {
      await this.quiet(
        this.api.delete(backendUrl(`/stockpile/${list}`), { params: { file: path }, silent: true }),
      );
    }
  }

  /**
   * Link or unlink a file on a contact (best effort).
   *
   * @param contactId - Contact.
   * @param path - File.
   * @param linked - Target state.
   */
  private async setContactFile(contactId: string, path: string, linked: boolean): Promise<void> {
    const url = backendUrl(`/contact/${contactId}/file`);
    const options = { params: { file: path }, silent: true };
    await this.quiet(
      linked ? this.api.post(url, undefined, options) : this.api.delete(url, options),
    );
  }

  /**
   * Rename the SOTA citation record key (the backend renames `sota_info_*` itself).
   *
   * @param oldPath - Previous path.
   * @param newPath - New path.
   */
  private async renameCitationRecord(oldPath: string, newPath: string): Promise<void> {
    const oldKey = citationKeyOf(oldPath);
    const newKey = citationKeyOf(newPath);
    if (oldKey === null || newKey === null || oldKey === newKey) {
      return;
    }
    const value = await this.quiet(
      this.api.get<string>(backendUrl(`/stockpile/get/${encodeURIComponent(oldKey)}`), {
        silent: true,
      }),
    );
    if (value !== null) {
      await this.quiet(
        this.api.post(backendUrl(`/stockpile/set/${encodeURIComponent(newKey)}`), undefined, {
          params: { value },
          silent: true,
        }),
      );
      await this.quiet(
        this.api.delete(backendUrl(`/stockpile/delete/${encodeURIComponent(oldKey)}`), {
          silent: true,
        }),
      );
    }
  }

  /**
   * Await a best-effort call: failures resolve to `null`.
   *
   * @param call - Pending call.
   * @returns The result, or `null` on failure.
   */
  private async quiet<T>(call: Promise<T>): Promise<T | null> {
    try {
      return await call;
    } catch {
      return null;
    }
  }
}

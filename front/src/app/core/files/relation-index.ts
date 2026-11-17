import { inject, Injectable } from '@angular/core';
import type {
  BackendProject,
  ContactDetail,
  ContactSummary,
  FileContact,
  FileRelations,
  RelationsByPath,
  Tag,
} from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { DataSync } from '../state/data-sync.service';
import { mapWithConcurrency } from '../util/concurrency';

const INDEX_TTL_MS = 20_000;
const CONCURRENCY = 6;
const NOT_FOUND = 404;

/** Inverted index file → projects/tags/contacts/pinned. */
interface Index {
  readonly projects: ReadonlyMap<string, readonly string[]>;
  readonly tags: ReadonlyMap<string, readonly string[]>;
  readonly contacts: ReadonlyMap<string, readonly FileContact[]>;
  readonly pinned: ReadonlySet<string>;
}

/** Cached index with what it was built from. */
interface CachedIndex {
  readonly at: number;
  readonly contactsVersion: number;
  readonly index: Promise<Index>;
}

/**
 * Invert `name → files` lists into `file → names`.
 *
 * @param entries - Pairs of name and its files.
 * @returns Map from file to names.
 */
export function invertRelations(
  entries: readonly (readonly [string, readonly string[]])[],
): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const [name, files] of entries) {
    for (const file of files) {
      byFile.set(file, [...(byFile.get(file) ?? []), name]);
    }
  }
  return byFile;
}

/**
 * Invert contacts and their files into `file → contacts`.
 *
 * @param contacts - Contacts with their linked files.
 * @returns Map from file to contacts.
 */
export function invertContacts(contacts: readonly ContactDetail[]): Map<string, FileContact[]> {
  const byFile = new Map<string, FileContact[]>();
  for (const { id, name, files } of contacts) {
    for (const file of files) {
      byFile.set(file, [...(byFile.get(file) ?? []), { id, name }]);
    }
  }
  return byFile;
}

/**
 * Projects, tags, people and pins of many files without one request per file: the lists of every
 * project, tag and contact are inverted once (short cache, since the Streamlit front writes too).
 */
@Injectable({ providedIn: 'root' })
export class RelationIndex {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);
  private cached: CachedIndex | null = null;

  /**
   * Relations of files.
   *
   * @param paths - File paths.
   * @returns Relations keyed by path.
   */
  async relationsOf(paths: readonly string[]): Promise<RelationsByPath> {
    const index = await this.index();
    const result: Record<string, FileRelations> = {};
    for (const path of paths) {
      result[path] = {
        projects: index.projects.get(path) ?? [],
        tags: index.tags.get(path) ?? [],
        contacts: index.contacts.get(path) ?? [],
        pinned: index.pinned.has(path),
      };
    }
    return result;
  }

  /** Drop the cache after a write. */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * Cached index, rebuilt when stale or after a contact write.
   *
   * @returns The index.
   */
  private index(): Promise<Index> {
    const now = Date.now();
    const contactsVersion = this.sync.version('contacts')();
    if (
      this.cached === null ||
      now - this.cached.at > INDEX_TTL_MS ||
      this.cached.contactsVersion !== contactsVersion
    ) {
      const index = this.build();
      this.cached = { at: now, contactsVersion, index };
      index.catch(() => {
        this.cached = null;
      });
    }
    return this.cached.index;
  }

  /**
   * Fetch every project/tag/contact file list and the pins.
   *
   * @returns The index.
   */
  private async build(): Promise<Index> {
    const [projects, tags, contacts, pinned] = await Promise.all([
      this.api.get<BackendProject[]>(backendUrl('/projects'), { silent: true }),
      this.api.get<Tag[]>(backendUrl('/tags'), { silent: true }),
      this.api.get<ContactSummary[]>(backendUrl('/contacts'), { silent: true }),
      this.api.get<string[]>(backendUrl('/pinned'), { silent: true }),
    ]);
    const projectFiles = await mapWithConcurrency(projects, CONCURRENCY, async ({ name }) => {
      return [name, await this.filesOf(`/project/${encodeURIComponent(name)}/files`)] as const;
    });
    const tagFiles = await mapWithConcurrency(tags, CONCURRENCY, async ({ name }) => {
      return [name, await this.filesOf(`/tag/${encodeURIComponent(name)}/files`)] as const;
    });
    const contactDetails = await mapWithConcurrency(contacts, CONCURRENCY, ({ id }) =>
      this.api.get<ContactDetail>(backendUrl(`/contacts/${encodeURIComponent(id)}`), {
        silent: true,
      }),
    );
    return {
      projects: invertRelations(projectFiles),
      tags: invertRelations(tagFiles),
      contacts: invertContacts(contactDetails),
      pinned: new Set(pinned),
    };
  }

  /**
   * Files of a project or tag (an empty tag answers 404).
   *
   * @param path - Backend path.
   * @returns Paths.
   */
  private async filesOf(path: string): Promise<string[]> {
    try {
      return await this.api.get<string[]>(backendUrl(path), { silent: true });
    } catch (error) {
      if (hasStatus(error, NOT_FOUND)) {
        return [];
      }
      throw error;
    }
  }
}

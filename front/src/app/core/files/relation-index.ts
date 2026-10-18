import { inject, Injectable } from '@angular/core';
import type { BackendProject, FileRelations, RelationsByPath, Tag } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';
import { hasStatus } from '../api/api-error';
import { mapWithConcurrency } from '../util/concurrency';

const INDEX_TTL_MS = 20_000;
const CONCURRENCY = 6;
const NOT_FOUND = 404;

/** Inverted index file → projects/tags/pinned. */
interface Index {
  readonly projects: ReadonlyMap<string, readonly string[]>;
  readonly tags: ReadonlyMap<string, readonly string[]>;
  readonly pinned: ReadonlySet<string>;
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
 * Projects, tags and pins of many files without one request per file: the lists of every
 * project and tag are inverted once (short cache, since the Streamlit front writes too).
 */
@Injectable({ providedIn: 'root' })
export class RelationIndex {
  private readonly api = inject(ApiClient);
  private cached: { readonly at: number; readonly index: Promise<Index> } | null = null;

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
   * Cached index, rebuilt when stale.
   *
   * @returns The index.
   */
  private index(): Promise<Index> {
    const now = Date.now();
    if (this.cached === null || now - this.cached.at > INDEX_TTL_MS) {
      const index = this.build();
      this.cached = { at: now, index };
      index.catch(() => {
        this.cached = null;
      });
    }
    return this.cached.index;
  }

  /**
   * Fetch every project/tag file list and the pins.
   *
   * @returns The index.
   */
  private async build(): Promise<Index> {
    const [projects, tags, pinned] = await Promise.all([
      this.api.get<BackendProject[]>(backendUrl('/projects'), { silent: true }),
      this.api.get<Tag[]>(backendUrl('/tags'), { silent: true }),
      this.api.get<string[]>(backendUrl('/pinned'), { silent: true }),
    ]);
    const projectFiles = await mapWithConcurrency(projects, CONCURRENCY, async ({ name }) => {
      return [name, await this.filesOf(`/project/${encodeURIComponent(name)}/files`)] as const;
    });
    const tagFiles = await mapWithConcurrency(tags, CONCURRENCY, async ({ name }) => {
      return [name, await this.filesOf(`/tag/${encodeURIComponent(name)}/files`)] as const;
    });
    return {
      projects: invertRelations(projectFiles),
      tags: invertRelations(tagFiles),
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

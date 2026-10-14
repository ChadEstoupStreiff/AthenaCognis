import { computed, inject, Injectable, resource } from '@angular/core';
import type { BackendProject, ContactSummary, Project, Tag } from '@domain/contracts';
import { colorForName, normalizeHexColor } from '@domain/color';
import { toProject } from '@domain/mappers';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/** Projects, tags and contacts (shared by pickers and badges). */
@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /** All projects. */
  readonly projects = resource({
    params: () => this.sync.version('projects')(),
    loader: async ({ abortSignal }) =>
      (await this.api.get<BackendProject[]>(backendUrl('/projects'), { signal: abortSignal })).map(
        toProject,
      ),
  });

  /** All tags. */
  readonly tags = resource({
    params: () => this.sync.version('tags')(),
    loader: ({ abortSignal }) => this.api.get<Tag[]>(backendUrl('/tags'), { signal: abortSignal }),
  });

  /** All contacts. */
  readonly contacts = resource({
    params: () => this.sync.version('contacts')(),
    loader: ({ abortSignal }) =>
      this.api.get<ContactSummary[]>(backendUrl('/contacts'), { signal: abortSignal }),
  });

  /** Project list (empty while loading). */
  readonly projectList = computed<readonly Project[]>(() =>
    this.projects.hasValue() ? this.projects.value() : [],
  );

  /** Tag list (empty while loading). */
  readonly tagList = computed<readonly Tag[]>(() =>
    this.tags.hasValue() ? this.tags.value() : [],
  );

  /** Contact list (empty while loading). */
  readonly contactList = computed<readonly ContactSummary[]>(() =>
    this.contacts.hasValue() ? this.contacts.value() : [],
  );

  private readonly projectColors = computed(
    () =>
      new Map(
        this.projectList().map((project) => [project.name, normalizeHexColor(project.color)]),
      ),
  );

  private readonly tagColors = computed(
    () => new Map(this.tagList().map((tag) => [tag.name, normalizeHexColor(tag.color)])),
  );

  /**
   * Color of a project (deterministic fallback).
   *
   * @param name - Project name.
   * @returns Hex color.
   */
  projectColor(name: string): string {
    return this.projectColors().get(name) ?? colorForName(name);
  }

  /**
   * Color of a tag (deterministic fallback).
   *
   * @param name - Tag name.
   * @returns Hex color.
   */
  tagColor(name: string): string {
    return this.tagColors().get(name) ?? colorForName(name);
  }
}

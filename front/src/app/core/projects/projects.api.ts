import { inject, Injectable } from '@angular/core';
import type {
  BackendProject,
  ContactSummary,
  Project,
  ProjectInput,
  TagInput,
  TodoItem,
} from '@domain/contracts';
import { parseTodo, toBackendTodo, toProject } from '@domain/mappers';
import { ApiClient, backendUrl } from '../api/api-client';
import { DataSync } from '../state/data-sync.service';

/**
 * Encode a project or tag name as a path segment.
 *
 * @param name - Name.
 * @returns Encoded segment.
 */
function segment(name: string): string {
  return encodeURIComponent(name);
}

/**
 * Strip the `#` (the backend adds it).
 *
 * @param color - Hex color.
 * @returns Color without `#`.
 */
function bare(color: string): string {
  return color.replace(/^#/, '');
}

/** Projects and tags. */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(DataSync);

  /**
   * One project.
   *
   * @param name - Project name.
   * @returns The project.
   */
  async get(name: string): Promise<Project> {
    return toProject(await this.api.get<BackendProject>(backendUrl(`/project/${segment(name)}`)));
  }

  /**
   * Files of a project.
   *
   * @param name - Project name.
   * @returns Paths.
   */
  files(name: string): Promise<string[]> {
    return this.api.get<string[]>(backendUrl(`/project/${segment(name)}/files`));
  }

  /**
   * People of a project.
   *
   * @param name - Project name.
   * @returns Contacts.
   */
  contacts(name: string): Promise<ContactSummary[]> {
    return this.api.get<ContactSummary[]>(backendUrl(`/project/${segment(name)}/contacts`));
  }

  /**
   * Notes of a project.
   *
   * @param name - Project name.
   * @returns Markdown.
   */
  notes(name: string): Promise<string> {
    return this.api.get<string>(backendUrl(`/project/${segment(name)}/notes`));
  }

  /**
   * Save project notes.
   *
   * @param name - Project name.
   * @param notes - Markdown.
   */
  async saveNotes(name: string, notes: string): Promise<void> {
    await this.api.post(backendUrl(`/project/${segment(name)}/notes`), undefined, {
      params: { notes },
      silent: true,
    });
  }

  /**
   * TODO list of a project.
   *
   * @param name - Project name.
   * @returns Items.
   */
  async todo(name: string): Promise<TodoItem[]> {
    return parseTodo(await this.api.get<unknown>(backendUrl(`/project/${segment(name)}/todo`)));
  }

  /**
   * Save the TODO list.
   *
   * @param name - Project name.
   * @param items - Items.
   */
  async saveTodo(name: string, items: readonly TodoItem[]): Promise<void> {
    await this.api.post(backendUrl(`/project/${segment(name)}/todo`), undefined, {
      params: { todo: JSON.stringify(toBackendTodo(items)) },
      silent: true,
    });
  }

  /**
   * Create a project.
   *
   * @param input - Project.
   */
  async create(input: ProjectInput): Promise<void> {
    await this.api.post(backendUrl('/project'), undefined, {
      params: { name: input.name.trim(), color: bare(input.color), description: input.description },
    });
    this.sync.invalidate('projects');
  }

  /**
   * Edit or rename a project.
   *
   * @param name - Current name.
   * @param input - New values.
   */
  async update(name: string, input: ProjectInput): Promise<void> {
    await this.api.put(backendUrl(`/project/${segment(name)}`), undefined, {
      params: {
        name: input.name === name ? null : input.name.trim(),
        color: bare(input.color),
        description: input.description,
      },
    });
    this.sync.invalidate('projects', 'files', 'calendar');
  }

  /**
   * Delete a project (its time entries are deleted too, by the database cascade).
   *
   * @param name - Project name.
   */
  async delete(name: string): Promise<void> {
    await this.api.delete(backendUrl(`/project/${segment(name)}`));
    this.sync.invalidate('projects', 'files', 'calendar');
  }

  /**
   * Create a tag.
   *
   * @param input - Tag.
   */
  async createTag(input: TagInput): Promise<void> {
    await this.api.post(backendUrl('/tag'), undefined, {
      params: { name: input.name.trim(), color: bare(input.color) },
    });
    this.sync.invalidate('tags');
  }

  /**
   * Edit or rename a tag.
   *
   * @param name - Current name.
   * @param input - New values.
   */
  async updateTag(name: string, input: TagInput): Promise<void> {
    await this.api.put(backendUrl(`/tag/${segment(name)}`), undefined, {
      params: { name: input.name === name ? null : input.name.trim(), color: bare(input.color) },
    });
    this.sync.invalidate('tags', 'files');
  }

  /**
   * Delete a tag.
   *
   * @param name - Tag name.
   */
  async deleteTag(name: string): Promise<void> {
    await this.api.delete(backendUrl(`/tag/${segment(name)}`));
    this.sync.invalidate('tags', 'files');
  }
}

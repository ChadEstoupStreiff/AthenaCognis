import { inject, Injectable } from '@angular/core';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { FilesApi } from '../../core/files/files.api';
import { extractReferences, type NoteReferences } from './note-references';

/** Relations a note already has. */
interface KnownRelations {
  readonly contacts: Set<string>;
  readonly tags: Set<string>;
  readonly projects: Set<string>;
  readonly files: Set<string>;
}

/** References not linked yet. */
type MissingRelations = NoteReferences;

const LINK_FORCE = 1;
const LINK_COMMENT = 'Linked from note';

/**
 * Items of a list missing from a set.
 *
 * @param values - Candidates.
 * @param known - Already linked.
 * @param allowed - Existing entities (unknown names are skipped).
 * @returns Missing values.
 */
function missing(
  values: readonly string[],
  known: ReadonlySet<string>,
  allowed: ReadonlySet<string> | null,
): string[] {
  return values.filter((value) => !known.has(value) && (allowed === null || allowed.has(value)));
}

/**
 * Link a note to the people, tags, projects and files it mentions (additions only:
 * removing a mention never removes a relation that may have been set elsewhere).
 */
@Injectable()
export class NoteRelations {
  private readonly catalog = inject(CatalogStore);
  private readonly details = inject(FileDetailsApi);
  private readonly files = inject(FilesApi);
  private readonly known = new Map<string, Promise<KnownRelations>>();

  /**
   * Add the relations of the references found in a note.
   *
   * @param path - Note path.
   * @param content - Note content.
   */
  async sync(path: string, content: string): Promise<void> {
    const references = extractReferences(content);
    if (Object.values(references).every((list: readonly string[]) => list.length === 0)) {
      return;
    }
    const known = await this.knownFor(path);
    const todo = this.missingRelations(path, references, known);
    await this.linkContacts(path, todo.contacts, known);
    await this.linkNames(path, todo, known);
    await this.linkFiles(path, todo.files, known);
  }

  /**
   * Drop cached relations (after a rename or delete).
   *
   * @param path - Note path.
   */
  forget(path: string): void {
    this.known.delete(path);
  }

  /**
   * References of a note not linked yet (unknown entities skipped).
   *
   * @param path - Note path.
   * @param references - References.
   * @param known - Existing relations.
   * @returns Missing relations.
   */
  private missingRelations(
    path: string,
    references: NoteReferences,
    known: KnownRelations,
  ): MissingRelations {
    const contactIds = new Set(this.catalog.contactList().map((contact) => contact.id));
    const tagNames = new Set(this.catalog.tagList().map((tag) => tag.name));
    const projectNames = new Set(this.catalog.projectList().map((project) => project.name));
    return {
      contacts: missing(references.contacts, known.contacts, contactIds),
      tags: missing(references.tags, known.tags, tagNames),
      projects: missing(references.projects, known.projects, projectNames),
      files: missing(references.files, known.files, null).filter((file) => file !== path),
    };
  }

  /**
   * Link people.
   *
   * @param path - Note path.
   * @param contacts - Contact ids.
   * @param known - Cache updated in place.
   */
  private async linkContacts(
    path: string,
    contacts: readonly string[],
    known: KnownRelations,
  ): Promise<void> {
    for (const contact of contacts) {
      await this.details.setContact(contact, path, true);
      known.contacts.add(contact);
    }
  }

  /**
   * Link tags and projects.
   *
   * @param path - Note path.
   * @param todo - Missing relations.
   * @param known - Cache updated in place.
   */
  private async linkNames(
    path: string,
    todo: MissingRelations,
    known: KnownRelations,
  ): Promise<void> {
    if (todo.tags.length + todo.projects.length === 0) {
      return;
    }
    await this.files.patchRelations({
      paths: [path],
      tags: { add: todo.tags, remove: [] },
      projects: { add: todo.projects, remove: [] },
    });
    todo.tags.forEach((tag) => known.tags.add(tag));
    todo.projects.forEach((project) => known.projects.add(project));
  }

  /**
   * Link files (wiki links and embeds); the viewer shows them as backlinks.
   *
   * @param path - Note path.
   * @param files - Target paths.
   * @param known - Cache updated in place.
   */
  private async linkFiles(
    path: string,
    files: readonly string[],
    known: KnownRelations,
  ): Promise<void> {
    for (const file of files) {
      await this.details.addLink(path, file, LINK_FORCE, LINK_COMMENT);
      known.files.add(file);
    }
  }

  /**
   * Relations of a note (fetched once per note).
   *
   * @param path - Note path.
   * @returns Known relations.
   */
  private knownFor(path: string): Promise<KnownRelations> {
    let known = this.known.get(path);
    if (known === undefined) {
      known = this.fetchKnown(path);
      this.known.set(path, known);
      known.catch(() => this.known.delete(path));
    }
    return known;
  }

  /**
   * Fetch the relations of a note.
   *
   * @param path - Note path.
   * @returns Known relations.
   */
  private async fetchKnown(path: string): Promise<KnownRelations> {
    const [relations, contacts, links] = await Promise.all([
      this.files.relations([path]),
      this.details.contactsOf(path),
      this.details.links(path),
    ]);
    return {
      contacts: new Set(contacts.map((contact) => contact.id)),
      tags: new Set(relations[path]?.tags ?? []),
      projects: new Set(relations[path]?.projects ?? []),
      files: new Set(links.map((link) => link.other)),
    };
  }
}

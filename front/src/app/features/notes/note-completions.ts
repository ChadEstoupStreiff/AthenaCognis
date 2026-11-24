import { inject, Injectable } from '@angular/core';
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  pickedCompletion,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import {
  fileNameOf,
  isHiddenArtefactPath,
  isSharedFilePath,
  parseSharedPath,
  splitExtension,
} from '@domain/files';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FilesApi } from '../../core/files/files.api';
import { searchEmojis } from '../../shared/text/emoji';
import { fileMarkdown, mentionMarkdown, projectMarkdown, tagMarkdown } from './note-references';

const MAX_EMOJIS = 30;
const MAX_FILES = 40;
const FILE_CACHE_MS = 60_000;
const EMOJI_TRIGGER = /(?:^|\s):[\w+-]{2,}$/;
const MENTION_TRIGGER = /(?:^|[\s(])@[^\s@]*$/;
const TAG_TRIGGER = /(?:^|\s)#[^\s#]+$/;
const PROJECT_TRIGGER = /(?:^|\s)\+[^\s+]+$/;
const WIKI_TRIGGER = /\[\[[^\]\n]*$/;
const WIKI_OPEN = '[[';

/**
 * Text typed after the trigger character, with the start offset of the trigger itself.
 *
 * @param context - Completion context.
 * @param pattern - Trigger pattern (may start with one whitespace character).
 * @returns Start offset and typed text, or `null` when the trigger is absent.
 */
function triggered(
  context: CompletionContext,
  pattern: RegExp,
): { from: number; text: string } | null {
  const match = context.matchBefore(pattern);
  if (match === null) {
    return null;
  }
  const leading = /^[\s(]/.test(match.text) ? 1 : 0;
  return { from: match.from + leading, text: match.text.slice(leading) };
}

/**
 * Completion result over static options.
 *
 * @param from - Start of the replaced text.
 * @param options - Options.
 * @returns Result.
 */
function result(from: number, options: Completion[]): CompletionResult {
  return { from, options, filter: true };
}

/**
 * Apply a wiki-link completion, swallowing the `]]` auto-inserted by bracket closing.
 *
 * @param markdown - Link Markdown.
 * @returns Completion apply function.
 */
function applyWikiLink(
  markdown: string,
): (view: EditorView, completion: Completion, from: number, to: number) => void {
  return (view, completion, from, to) => {
    const closing = /^\]{0,2}/.exec(view.state.sliceDoc(to, to + 2))?.[0] ?? '';
    view.dispatch({
      changes: { from, to: to + closing.length, insert: markdown },
      selection: { anchor: from + markdown.length },
      annotations: pickedCompletion.of(completion),
    });
  };
}

/** Autocompletion for notes: `:emoji`, `@person`, `#tag`, `+project`, `[[file`. */
@Injectable()
export class NoteCompletions {
  private readonly catalog = inject(CatalogStore);
  private readonly files = inject(FilesApi);
  private fileCache: { at: number; paths: Promise<string[]> } | null = null;

  /** Every note completion source. */
  readonly sources: readonly CompletionSource[] = [
    this.emojis.bind(this),
    this.mentions.bind(this),
    this.tags.bind(this),
    this.projects.bind(this),
    this.wikiLinks.bind(this),
  ];

  /**
   * `:smile` → 😄.
   *
   * @param context - Completion context.
   * @returns Result, or `null`.
   */
  private emojis(context: CompletionContext): CompletionResult | null {
    const trigger = triggered(context, EMOJI_TRIGGER);
    if (trigger === null) {
      return null;
    }
    const options = searchEmojis(trigger.text.slice(1), MAX_EMOJIS).map((emoji) => ({
      label: `:${emoji.name}:`,
      detail: emoji.char,
      apply: emoji.char,
      type: 'text',
    }));
    return { from: trigger.from, options, filter: false };
  }

  /**
   * `@name` → link to the person.
   *
   * @param context - Completion context.
   * @returns Result, or `null`.
   */
  private mentions(context: CompletionContext): CompletionResult | null {
    const trigger = triggered(context, MENTION_TRIGGER);
    if (trigger === null) {
      return null;
    }
    return result(
      trigger.from,
      this.catalog.contactList().map((contact) => ({
        label: `@${contact.name}`,
        detail: contact.company ?? contact.email ?? '',
        apply: mentionMarkdown(contact.id, contact.name),
        type: 'variable',
      })),
    );
  }

  /**
   * `#tag` → link to the tag.
   *
   * @param context - Completion context.
   * @returns Result, or `null`.
   */
  private tags(context: CompletionContext): CompletionResult | null {
    const trigger = triggered(context, TAG_TRIGGER);
    if (trigger === null) {
      return null;
    }
    return result(
      trigger.from,
      this.catalog.tagList().map((tag) => ({
        label: `#${tag.name}`,
        apply: tagMarkdown(tag.name),
        type: 'keyword',
      })),
    );
  }

  /**
   * `+project` → link to the project.
   *
   * @param context - Completion context.
   * @returns Result, or `null`.
   */
  private projects(context: CompletionContext): CompletionResult | null {
    const trigger = triggered(context, PROJECT_TRIGGER);
    if (trigger === null) {
      return null;
    }
    return result(
      trigger.from,
      this.catalog.projectList().map((project) => ({
        label: `+${project.name}`,
        detail: project.description,
        apply: projectMarkdown(project.name),
        type: 'class',
      })),
    );
  }

  /**
   * `[[name` → link to a file (notes and documents).
   *
   * @param context - Completion context.
   * @returns Result, or `null`.
   */
  private async wikiLinks(context: CompletionContext): Promise<CompletionResult | null> {
    const trigger = context.matchBefore(WIKI_TRIGGER);
    if (trigger === null) {
      return null;
    }
    const query = trigger.text.slice(WIKI_OPEN.length).toLowerCase();
    const paths = (await this.allFiles()).filter((path) =>
      fileNameOf(path).toLowerCase().includes(query),
    );
    const options = paths.slice(0, MAX_FILES).flatMap((path) => {
      const name = fileNameOf(path);
      const markdown = fileMarkdown(path, splitExtension(name).stem);
      const parts = parseSharedPath(path);
      return markdown === null
        ? []
        : [
            {
              label: name,
              detail: `${parts?.date ?? ''} · ${parts?.folder ?? ''}`,
              apply: applyWikiLink(markdown),
              type: 'text',
            },
          ];
    });
    return { from: trigger.from, options, filter: false };
  }

  /**
   * Every user file (cached for a minute).
   *
   * @returns Paths, newest first.
   */
  private allFiles(): Promise<string[]> {
    const now = Date.now();
    if (this.fileCache === null || now - this.fileCache.at > FILE_CACHE_MS) {
      const paths = this.files
        .allFiles()
        .then((list) =>
          list.filter((path) => isSharedFilePath(path) && !isHiddenArtefactPath(path)),
        );
      this.fileCache = { at: now, paths };
    }
    return this.fileCache.paths;
  }
}

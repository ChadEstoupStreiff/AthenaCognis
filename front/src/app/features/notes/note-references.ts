import { buildSharedPath, parseSharedPath } from '@domain/files';
import { scanLines } from '../../shared/text/markdown-structure';

/** App entities a note points to through its links. */
export interface NoteReferences {
  readonly contacts: readonly string[];
  readonly tags: readonly string[];
  readonly projects: readonly string[];
  /** Shared paths of linked or embedded files. */
  readonly files: readonly string[];
}

const LINK_PATTERN = /!?\[[^\]]*\]\(([^)\s]+)\)/g;
const PEOPLE_PREFIX = '/people/';
const PROJECTS_PREFIX = '/projects/';
const VIEWER_PREFIX = '/f/';
const TAG_ROUTE = '/library';
const TAG_PARAM = 'tags';
const URL_BASE = 'http://local';
const URL_UNSAFE = /[()]/g;
const HEX_RADIX = 16;
const VIEWER_SEGMENTS = 3;

/**
 * Encode a path segment for a Markdown link (parentheses included).
 *
 * @param segment - Raw segment.
 * @returns Encoded segment.
 */
export function encodeLinkSegment(segment: string): string {
  return encodeURIComponent(segment).replaceAll(
    URL_UNSAFE,
    (character) => `%${character.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`,
  );
}

/**
 * Link label without the brackets that would end it.
 *
 * @param label - Label.
 * @returns Safe label.
 */
function safeLabel(label: string): string {
  return label.replaceAll(/[[\]]/g, '');
}

/**
 * Markdown mention of a person.
 *
 * @param id - Contact id.
 * @param name - Display name.
 * @returns Markdown link.
 */
export function mentionMarkdown(id: string, name: string): string {
  return `[@${safeLabel(name)}](${PEOPLE_PREFIX}${encodeLinkSegment(id)})`;
}

/**
 * Markdown link to a tag (opens the library filtered on it).
 *
 * @param name - Tag name.
 * @returns Markdown link.
 */
export function tagMarkdown(name: string): string {
  return `[#${safeLabel(name)}](${TAG_ROUTE}?${TAG_PARAM}=${encodeLinkSegment(name)}&range=all)`;
}

/**
 * Markdown link to a project.
 *
 * @param name - Project name.
 * @returns Markdown link.
 */
export function projectMarkdown(name: string): string {
  return `[+${safeLabel(name)}](${PROJECTS_PREFIX}${encodeLinkSegment(name)})`;
}

/**
 * In-app viewer URL of a file.
 *
 * @param path - Shared path.
 * @returns URL, or `null` for invalid paths.
 */
export function viewerUrl(path: string): string | null {
  const parts = parseSharedPath(path);
  return parts === null
    ? null
    : `${VIEWER_PREFIX}${[parts.date, parts.folder, parts.name].map(encodeLinkSegment).join('/')}`;
}

/**
 * Markdown link (or embed card) to a file.
 *
 * @param path - Shared path.
 * @param label - Label.
 * @param embed - Render as a preview card.
 * @returns Markdown, or `null` for invalid paths.
 */
export function fileMarkdown(path: string, label: string, embed = false): string | null {
  const url = viewerUrl(path);
  return url === null ? null : `${embed ? '!' : ''}[${safeLabel(label)}](${url})`;
}

/**
 * Shared path of a viewer URL.
 *
 * @param pathname - `/f/<date>/<folder>/<name>` (encoded).
 * @returns Shared path, or `null`.
 */
function pathOfViewerUrl(pathname: string): string | null {
  const segments = pathname.slice(VIEWER_PREFIX.length).split('/').map(decodeURIComponent);
  const [date, folder, name] = segments;
  if (
    segments.length !== VIEWER_SEGMENTS ||
    date === undefined ||
    folder === undefined ||
    name === undefined
  ) {
    return null;
  }
  const path = buildSharedPath({ date, folder, name });
  return parseSharedPath(path) === null ? null : path;
}

/** Mutable accumulator of references. */
interface ReferenceSets {
  readonly contacts: Set<string>;
  readonly tags: Set<string>;
  readonly projects: Set<string>;
  readonly files: Set<string>;
}

/**
 * Record the entity a link URL points to.
 *
 * @param url - Link URL.
 * @param sets - Accumulator.
 */
function collect(url: string, sets: ReferenceSets): void {
  let parsed: URL;
  try {
    parsed = new URL(url, URL_BASE);
  } catch {
    return;
  }
  if (!url.startsWith('/')) {
    return;
  }
  const { pathname } = parsed;
  const rest = (prefix: string): string => decodeURIComponent(pathname.slice(prefix.length));
  if (pathname.startsWith(PEOPLE_PREFIX)) {
    sets.contacts.add(rest(PEOPLE_PREFIX));
  } else if (pathname.startsWith(PROJECTS_PREFIX)) {
    sets.projects.add(rest(PROJECTS_PREFIX));
  } else if (pathname === TAG_ROUTE) {
    parsed.searchParams
      .get(TAG_PARAM)
      ?.split('|')
      .forEach((tag) => sets.tags.add(tag));
  } else if (pathname.startsWith(VIEWER_PREFIX)) {
    const path = pathOfViewerUrl(pathname);
    if (path !== null) {
      sets.files.add(path);
    }
  }
}

/**
 * People, tags, projects and files linked from a note (code blocks skipped).
 *
 * @param doc - Markdown.
 * @returns References, deduplicated.
 */
export function extractReferences(doc: string): NoteReferences {
  const sets: ReferenceSets = {
    contacts: new Set(),
    tags: new Set(),
    projects: new Set(),
    files: new Set(),
  };
  for (const line of scanLines(doc)) {
    if (line.inFence) {
      continue;
    }
    for (const match of line.text.matchAll(LINK_PATTERN)) {
      collect(match[1] ?? '', sets);
    }
  }
  const values = (set: Set<string>): string[] => [...set].filter((value) => value !== '');
  return {
    contacts: values(sets.contacts),
    tags: values(sets.tags),
    projects: values(sets.projects),
    files: values(sets.files),
  };
}

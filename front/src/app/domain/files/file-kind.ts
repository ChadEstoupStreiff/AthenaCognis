import { DEFAULT_MIME, extensionOf, guessMime } from './mime';

/** How a file is rendered in the viewer. */
export type FileKind =
  | 'pdf'
  | 'image'
  | 'tiff'
  | 'audio'
  | 'video'
  | 'markdown'
  | 'json'
  | 'code'
  | 'table'
  | 'archive'
  | 'html'
  | 'text'
  | 'office'
  | 'binary';

/** Extensions shown as syntax-highlighted code, mapped to a language id. */
export const CODE_LANGUAGES: Readonly<Record<string, string>> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
  bash: 'bash',
  sh: 'bash',
  sql: 'sql',
  php: 'php',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  kt: 'kotlin',
  swift: 'swift',
  env: 'ini',
  toml: 'ini',
  ini: 'ini',
  r: 'r',
  tex: 'latex',
  xml: 'xml',
  ipynb: 'json',
  jsonl: 'json',
};

const TABLE_EXTENSIONS: ReadonlySet<string> = new Set(['csv', 'tsv', 'xlsx', 'xlsm', 'xls', 'ods']);
const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set(['zip', 'tar', 'gz', 'tgz', '7z', 'rar']);
const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set([
  'doc',
  'docx',
  'ppt',
  'pptx',
  'odt',
  'odp',
  'rtf',
  'epub',
]);
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown']);
const TIFF_EXTENSIONS: ReadonlySet<string> = new Set(['tif', 'tiff']);
const SVG_EXTENSIONS: ReadonlySet<string> = new Set(['svg']);
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'htm', ...SVG_EXTENSIONS]);

/**
 * Classify by extension for formats whose MIME type is ambiguous.
 *
 * @param extension - Lower-cased extension.
 * @returns The kind, or `null` when the MIME type decides.
 */
function kindFromExtension(extension: string): FileKind | null {
  if (extension === 'pdf') {
    return 'pdf';
  }
  if (TIFF_EXTENSIONS.has(extension)) {
    return 'tiff';
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown';
  }
  if (extension === 'json') {
    return 'json';
  }
  if (TABLE_EXTENSIONS.has(extension)) {
    return 'table';
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return 'html';
  }
  return null;
}

/**
 * Classify by extension groups and MIME prefixes.
 *
 * @param extension - Lower-cased extension.
 * @param mime - MIME type.
 * @returns The kind.
 */
function kindFromMime(extension: string, mime: string): FileKind {
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return 'archive';
  }
  if (extension in CODE_LANGUAGES) {
    return 'code';
  }
  if (OFFICE_EXTENSIONS.has(extension)) {
    return 'office';
  }
  const prefix = mime.split('/')[0];
  if (prefix === 'image' || prefix === 'audio' || prefix === 'video') {
    return prefix;
  }
  return prefix === 'text' ? 'text' : 'binary';
}

/**
 * Decide how to render a file.
 *
 * @param path - File path or name.
 * @param mime - MIME type from metadata (guessed from the name when absent).
 * @returns The file kind.
 */
export function fileKindOf(path: string, mime?: string): FileKind {
  const extension = extensionOf(path);
  const resolvedMime = mime === undefined || mime === DEFAULT_MIME ? guessMime(path) : mime;
  return kindFromExtension(extension) ?? kindFromMime(extension, resolvedMime);
}

/** PrimeIcons class per kind. */
export const FILE_KIND_ICONS: Readonly<Record<FileKind, string>> = {
  pdf: 'pi pi-file-pdf',
  image: 'pi pi-image',
  tiff: 'pi pi-image',
  audio: 'pi pi-volume-up',
  video: 'pi pi-video',
  markdown: 'pi pi-file-edit',
  json: 'pi pi-code',
  code: 'pi pi-code',
  table: 'pi pi-table',
  archive: 'pi pi-box',
  html: 'pi pi-globe',
  text: 'pi pi-align-left',
  office: 'pi pi-file-word',
  binary: 'pi pi-file',
};

/**
 * Check whether a file can be OCR'd (images only, like the backend).
 *
 * @param kind - File kind.
 * @returns `true` for images.
 */
export function supportsOcr(kind: FileKind): boolean {
  return kind === 'image' || kind === 'tiff';
}

/**
 * Check whether a file can be transcribed (audio and video).
 *
 * @param kind - File kind.
 * @returns `true` for audio and video.
 */
export function supportsTranscription(kind: FileKind): boolean {
  return kind === 'audio' || kind === 'video';
}

/** Formats shown either rendered or as source code. */
export type RenderableKind = 'markdown' | 'html' | 'svg';

/**
 * Whether a file can be shown rendered or as source, and how it renders.
 *
 * @param path - File path.
 * @param kind - File kind.
 * @returns Renderable kind, or `null` for other formats.
 */
export function renderableKindOf(path: string, kind: FileKind): RenderableKind | null {
  if (kind === 'markdown') {
    return 'markdown';
  }
  if (kind !== 'html') {
    return null;
  }
  return SVG_EXTENSIONS.has(extensionOf(path)) ? 'svg' : 'html';
}

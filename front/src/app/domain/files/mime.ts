import { fileNameOf } from './shared-path';
import { splitExtension } from './upload-naming';

/** Fallback MIME type (same as the backend). */
export const DEFAULT_MIME = 'application/octet-stream';

/** Backend overrides of Python's `mimetypes` (`back/src/utils.py` and `front/src/utils.py`). */
const CUSTOM_MIME: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  env: 'text/env',
  yaml: 'text/x-yaml',
  yml: 'text/x-yaml',
  toml: 'text/toml',
  ipynb: 'application/x-ipynb+json',
  jsonl: 'application/x-ndjson',
  log: 'text/log',
  logs: 'text/log',
  webp: 'image/webp',
};

/** Common extensions as mapped by Python's `mimetypes` (used for icons before metadata loads). */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/vnd.microsoft.icon',
  mp3: 'audio/mpeg',
  wav: 'audio/x-wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  mpeg: 'video/mpeg',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  py: 'text/x-python',
  sh: 'application/x-sh',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
};

/**
 * Lower-cased extension of a file name, without the dot.
 *
 * @param path - File path or name.
 * @returns The extension, or an empty string.
 */
export function extensionOf(path: string): string {
  return splitExtension(fileNameOf(path)).extension.slice(1).toLowerCase();
}

/**
 * Guess a MIME type from the file name, like the backend's `guess_mime`.
 *
 * @param path - File path or name.
 * @returns The MIME type.
 */
export function guessMime(path: string): string {
  const extension = extensionOf(path);
  return CUSTOM_MIME[extension] ?? EXTENSION_MIME[extension] ?? DEFAULT_MIME;
}

/** Search filter category. */
export interface FileTypeCategory {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly mimes: readonly string[];
}

/** File type categories of the search form (port of `mimes_map_compressed`). */
export const FILE_TYPE_CATEGORIES: readonly FileTypeCategory[] = [
  {
    key: 'images',
    label: 'Images',
    icon: 'pi pi-image',
    mimes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/tiff',
      'image/bmp',
      'image/svg+xml',
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: 'pi pi-file-pdf',
    mimes: [
      'application/pdf',
      'application/rtf',
      'application/epub+zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  },
  {
    key: 'audio',
    label: 'Audio',
    icon: 'pi pi-volume-up',
    mimes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/x-ms-wma'],
  },
  {
    key: 'video',
    label: 'Video',
    icon: 'pi pi-video',
    mimes: [
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/webm',
      'video/x-ms-wmv',
      'video/x-flv',
      'video/mpeg',
    ],
  },
  {
    key: 'text',
    label: 'Text',
    icon: 'pi pi-align-left',
    mimes: [
      'text/plain',
      'text/markdown',
      'text/html',
      'text/csv',
      'text/x-python',
      'text/x-r',
      'text/x-sql',
      'text/x-latex',
      'text/x-shellscript',
      'text/x-csrc',
      'text/x-java-source',
    ],
  },
  {
    key: 'archives',
    label: 'Archives',
    icon: 'pi pi-box',
    mimes: [
      'application/zip',
      'application/x-7z-compressed',
      'application/x-rar-compressed',
      'application/x-tar',
      'application/gzip',
      'application/x-bzip',
      'application/x-bzip2',
      'application/x-iso9660-image',
    ],
  },
  {
    key: 'code',
    label: 'Code & data',
    icon: 'pi pi-code',
    mimes: [
      'application/json',
      'application/javascript',
      'application/x-python-code',
      'application/x-httpd-php',
      'application/x-sh',
      'application/x-bash',
      'application/x-csh',
      'application/xml',
      'application/octet-stream',
      'application/x-msdownload',
    ],
  },
];

/**
 * Expand category keys into their MIME types.
 *
 * @param keys - Category keys.
 * @returns The de-duplicated MIME list.
 */
export function mimesForCategories(keys: readonly string[]): string[] {
  const selected = FILE_TYPE_CATEGORIES.filter((category) => keys.includes(category.key));
  return [...new Set(selected.flatMap((category) => category.mimes))];
}

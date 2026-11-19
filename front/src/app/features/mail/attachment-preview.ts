/** How an attachment is shown in the page. */
export type AttachmentPreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

/** Attachment the preview dialog opens. */
export interface AttachmentRef {
  readonly messageId: string;
  readonly index: number;
  readonly filename: string;
}

/** Preview of a file type: how to show it and the MIME type forced on its blob. */
interface PreviewType {
  readonly kind: AttachmentPreviewKind;
  readonly mime: string;
}

/**
 * Previewable extensions. Only types the browser renders without running scripts
 * (no SVG, HTML or XML): the blob URL shares the app's origin.
 */
const PREVIEW_TYPES: Readonly<Record<string, PreviewType>> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  avif: { kind: 'image', mime: 'image/avif' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  webm: { kind: 'video', mime: 'video/webm' },
  ogv: { kind: 'video', mime: 'video/ogg' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  oga: { kind: 'audio', mime: 'audio/ogg' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  txt: { kind: 'text', mime: 'text/plain' },
  log: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'text', mime: 'text/plain' },
  csv: { kind: 'text', mime: 'text/plain' },
  json: { kind: 'text', mime: 'text/plain' },
  ics: { kind: 'text', mime: 'text/plain' },
};

/**
 * Lower-case extension of a file name.
 *
 * @param filename - File name.
 * @returns Extension without the dot, empty when none.
 */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Preview of an attachment, from its file name.
 *
 * @param filename - File name.
 * @returns Kind and forced MIME type, null when it is downloaded instead.
 */
export function previewType(filename: string): PreviewType | null {
  return PREVIEW_TYPES[fileExtension(filename)] ?? null;
}

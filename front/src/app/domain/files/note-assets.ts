import { splitExtension } from './upload-naming';

const DEFAULT_STEM = 'file';
const DEFAULT_IMAGE_STEM = 'image';
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
};
const PAD_TWO = 2;
const PAD_THREE = 3;

/**
 * Check whether a file is an image the notes editor can embed.
 *
 * @param file - File.
 * @returns `true` for image MIME types.
 */
export function isEmbeddableImage(file: Blob): boolean {
  return file.type.startsWith('image/');
}

/**
 * Unique file name for an uploaded asset (`<stem>-HH-MM-SS-mmm.<ext>`).
 *
 * @param fileName - Original name (clipboard images are usually `image.png`).
 * @param mime - MIME type.
 * @param now - Upload time.
 * @returns File name.
 */
export function noteAssetName(fileName: string, mime: string, now: Date): string {
  const { stem, extension } = splitExtension(fileName);
  const suffix = extension === '' ? (IMAGE_EXTENSIONS[mime] ?? '') : extension.toLowerCase();
  const fallbackStem = mime.startsWith('image/') ? DEFAULT_IMAGE_STEM : DEFAULT_STEM;
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(PAD_TWO, '0'))
    .join('-');
  const millis = String(now.getMilliseconds()).padStart(PAD_THREE, '0');
  return `${stem === '' ? fallbackStem : stem}-${time}-${millis}${suffix}`;
}

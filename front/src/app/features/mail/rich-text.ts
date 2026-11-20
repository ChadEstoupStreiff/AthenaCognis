import DOMPurify from 'dompurify';
import { escapeHtml } from '../../shared/text/highlight';

/** Tags never kept in written mail (pasted or loaded from a draft). */
const FORBIDDEN_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
/** Widest inline image kept as is; larger ones are scaled down before insertion. */
export const MAX_IMAGE_WIDTH = 1200;

/** Pixel size of each `<font size>` step, shared by the editor display and the sent mail. */
export const FONT_SIZE_PX: Readonly<Record<string, string>> = {
  '1': '10px',
  '2': '12px',
  '3': '14px',
  '4': '16px',
  '5': '20px',
  '6': '28px',
  '7': '40px',
};
/** Class marking the image selected in the editor (never sent). */
export const SELECTED_IMAGE_CLASS = 'selected';

/** Image size in pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Convert plain text to HTML, line breaks kept.
 *
 * @param text - Plain text.
 * @returns HTML.
 */
export function textToHtml(text: string): string {
  return escapeHtml(text).replaceAll(/\r?\n/g, '<br>');
}

/**
 * Clean HTML written in (or pasted into) the mail editor.
 *
 * @param html - Untrusted HTML.
 * @returns HTML without scripts, frames or form controls; data URI images kept.
 */
export function sanitizeMailHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: FORBIDDEN_TAGS });
}

/**
 * Tell whether editor HTML holds nothing worth sending.
 *
 * @param text - Visible text of the editor.
 * @param html - Editor HTML.
 * @returns True when there is no text and no image.
 */
export function isBlankContent(text: string, html: string): boolean {
  return text.trim() === '' && !/<img\b/i.test(html);
}

/**
 * Size an image down to a maximum width, keeping its ratio.
 *
 * @param size - Natural size.
 * @param maxWidth - Widest allowed.
 * @returns Size to draw.
 */
export function fitWithin(size: ImageSize, maxWidth: number = MAX_IMAGE_WIDTH): ImageSize {
  if (size.width <= maxWidth) {
    return size;
  }
  return { width: maxWidth, height: Math.round((size.height * maxWidth) / size.width) };
}

/**
 * Replace `<font>` tags (ignored by many mail clients) by spans with inline CSS.
 *
 * @param root - Element whose `<font>` descendants are replaced.
 */
export function fontsToSpans(root: ParentNode): void {
  for (const font of Array.from(root.querySelectorAll<HTMLElement>('font'))) {
    const span = font.ownerDocument.createElement('span');
    span.style.cssText = font.style.cssText;
    const size = FONT_SIZE_PX[font.getAttribute('size') ?? ''];
    if (size !== undefined) {
      span.style.fontSize = size;
    }
    const color = font.getAttribute('color');
    if (color) {
      span.style.color = color;
    }
    const face = font.getAttribute('face');
    if (face) {
      span.style.fontFamily = face;
    }
    span.append(...Array.from(font.childNodes));
    font.replaceWith(span);
  }
}

/**
 * HTML of the editor as sent: inline CSS instead of `<font>`, no selection marker.
 *
 * @param editor - Editor element (left untouched).
 * @returns HTML.
 */
export function mailReadyHtml(editor: HTMLElement): string {
  const copy = editor.cloneNode(true) as HTMLElement;
  fontsToSpans(copy);
  for (const image of Array.from(copy.querySelectorAll(`img.${SELECTED_IMAGE_CLASS}`))) {
    image.classList.remove(SELECTED_IMAGE_CLASS);
    if (image.classList.length === 0) {
      image.removeAttribute('class');
    }
  }
  return copy.innerHTML;
}

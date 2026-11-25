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
/** Look of citations in the sent mail (inline: mail clients ignore stylesheets). */
export const QUOTE_STYLE =
  'margin:0 0 0 0.8ex;padding-left:1ex;border-left:2px solid #ccc;color:#555';
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
 * Tell whether a citation has no style of its own (none, or the bare indent browsers add).
 *
 * @param quote - `<blockquote>` element.
 * @returns True when the citation look should be applied.
 */
function isUnstyledQuote(quote: HTMLElement): boolean {
  const style = quote.getAttribute('style');
  return style === null || quote.style.borderStyle === 'none' || quote.style.border === 'none';
}

/**
 * Give citations without their own style the mail citation look.
 *
 * @param root - Element whose `<blockquote>` descendants are styled.
 */
export function styleQuotes(root: ParentNode): void {
  for (const quote of Array.from(root.querySelectorAll<HTMLElement>('blockquote'))) {
    if (isUnstyledQuote(quote)) {
      quote.setAttribute('style', QUOTE_STYLE);
    }
  }
}

/**
 * Citation holding a node, inside an editor.
 *
 * @param node - Node (caret position).
 * @param editor - Editor element (search stops there).
 * @returns Closest `<blockquote>`, null when none.
 */
export function quoteAround(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const quote = element?.closest('blockquote') ?? null;
  return quote !== null && editor.contains(quote) && quote !== editor ? quote : null;
}

/**
 * Replace an element by its children.
 *
 * @param element - Element removed, content kept.
 */
export function unwrap(element: HTMLElement): void {
  element.replaceWith(...Array.from(element.childNodes));
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
  styleQuotes(copy);
  for (const image of Array.from(copy.querySelectorAll(`img.${SELECTED_IMAGE_CLASS}`))) {
    image.classList.remove(SELECTED_IMAGE_CLASS);
    if (image.classList.length === 0) {
      image.removeAttribute('class');
    }
  }
  return copy.innerHTML;
}

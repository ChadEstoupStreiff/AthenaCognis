import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import DOMPurify from 'dompurify';

/**
 * CSP of the frame: no scripts, no network. Remote images (tracking pixels) are blocked unless
 * the reader allows them.
 */
const BLOCKED_IMAGES_CSP =
  "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:";
const ALLOWED_IMAGES_CSP =
  "default-src 'none'; img-src data: cid: https: http:; style-src 'unsafe-inline'; font-src data:";

const BASE_STYLE =
  'body{margin:0;padding:4px;font:14px/1.5 system-ui,sans-serif;color:#1f2933;background:#fff;' +
  'word-break:break-word}img{max-width:100%;height:auto}a{color:#2563eb}';

/**
 * Build the sandboxed document of an HTML mail.
 *
 * @param html - Raw HTML body.
 * @param allowImages - Load remote images.
 * @returns Full HTML document.
 */
export function mailDocument(html: string, allowImages: boolean): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed'],
  });
  const csp = allowImages ? ALLOWED_IMAGES_CSP : BLOCKED_IMAGES_CSP;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<base target="_blank"><style>${BASE_STYLE}</style></head><body>${clean}</body></html>`
  );
}

/** HTML mail rendered in a script-less sandboxed iframe. */
@Component({
  selector: 'ac-mail-frame',
  template: `<iframe
    [srcdoc]="document()"
    sandbox="allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    title="Mail content"
  ></iframe>`,
  styles: `
    :host {
      display: block;
    }
    iframe {
      width: 100%;
      height: 60vh;
      border: 1px solid var(--ac-panel-border);
      border-radius: 10px;
      background: #fff;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailFrameComponent {
  /** Raw HTML body. */
  readonly html = input.required<string>();
  /** Load remote images. */
  readonly allowImages = input(false);

  private readonly sanitizer = inject(DomSanitizer);

  /** Already sanitized by DOMPurify; trusted so Angular keeps the CSP meta and styles. */
  protected readonly document = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(mailDocument(this.html(), this.allowImages())),
  );
}

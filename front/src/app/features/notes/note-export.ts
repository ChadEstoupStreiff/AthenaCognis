import { Injectable } from '@angular/core';
import { triggerDownload } from '../../core/files/files.api';
import { renderMarkdown } from '../../shared/text/markdown';
import { enhanceMarkdown } from '../../shared/text/markdown-enhance';

/** Export formats. */
export type ExportFormat = 'html' | 'pdf' | 'word';

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css';
const MHTML_BOUNDARY = '----=_AthenaCognisNote';
const OFFSCREEN_STYLE = 'position:absolute;left:-10000px;top:0;width:800px;';
const PRINT_DELAY_MS = 300;
const REVOKE_DELAY_MS = 1000;
const BASE64_LINE = 76;

/** Print and file styles of an exported note. */
const EXPORT_CSS = `
body { font: 15px/1.6 -apple-system, 'Segoe UI', Inter, Arial, sans-serif; color: #1f2328; max-width: 820px; margin: 32px auto; padding: 0 24px; }
h1, h2, h3, h4 { line-height: 1.3; margin: 1.2em 0 .5em; }
pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f3f4f6; border-radius: 6px; }
code { padding: .1em .35em; font-size: .9em; }
pre { padding: 12px 14px; overflow: auto; }
pre code { padding: 0; background: none; }
blockquote { margin: 0 0 1em; padding: 2px 14px; border-left: 3px solid #6366f1; color: #57606a; }
.callout { border-radius: 6px; background: #f6f8fa; color: inherit; }
.callout-title { font-weight: 600; margin-bottom: 0; }
.callout-note { border-color: #2563eb; } .callout-tip { border-color: #16a34a; }
.callout-important { border-color: #7c3aed; } .callout-warning { border-color: #ca8a04; }
.callout-caution { border-color: #dc2626; }
table { border-collapse: collapse; margin: 0 0 1em; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
img, svg { max-width: 100%; }
figure { margin: 0 0 1em; } figcaption { color: #57606a; font-size: .9em; text-align: center; }
.file-embed { display: inline-flex; flex-direction: column; border: 1px solid #d0d7de; border-radius: 8px; padding: 6px; text-decoration: none; color: inherit; max-width: 260px; }
.file-embed-thumb.broken { display: none; }
hr { border: none; border-top: 1px solid #d0d7de; }
`;

/** Embedded image of a Word export. */
interface MhtmlPart {
  readonly location: string;
  readonly type: string;
  readonly base64: string;
}

/**
 * Read a blob as a data URL.
 *
 * @param blob - Blob.
 * @returns Data URL.
 */
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Cannot read the image.'));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch an image of the note.
 *
 * @param source - Image URL.
 * @returns Blob, or `null` when it cannot be loaded.
 */
async function fetchImage(source: string): Promise<Blob | null> {
  try {
    const response = await fetch(source);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

/**
 * Safe download name of a note.
 *
 * @param title - Note title.
 * @param extension - File extension.
 * @returns File name.
 */
function fileName(title: string, extension: string): string {
  return `${title.replaceAll(/[\\/:*?"<>|]/g, '-').trim() || 'post-it'}.${extension}`;
}

/**
 * Standalone HTML document.
 *
 * @param title - Title.
 * @param body - Body HTML.
 * @returns Document.
 */
function htmlDocument(title: string, body: string): string {
  const safeTitle = title.replaceAll('<', '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><link rel="stylesheet" href="${KATEX_CSS}"><style>${EXPORT_CSS}</style></head><body>${body}</body></html>`;
}

/**
 * Wrap a base64 string at the MIME line length.
 *
 * @param base64 - Base64 text.
 * @returns Wrapped text.
 */
function wrapBase64(base64: string): string {
  return base64.match(new RegExp(`.{1,${String(BASE64_LINE)}}`, 'g'))?.join('\r\n') ?? '';
}

/** Note export to HTML, PDF (print) and Word (MHTML `.doc`), images included. */
@Injectable({ providedIn: 'root' })
export class NoteExport {
  /**
   * Export a note.
   *
   * @param source - Markdown.
   * @param title - Title (file name).
   * @param format - Format.
   */
  async export(source: string, title: string, format: ExportFormat): Promise<void> {
    const root = await this.render(source);
    try {
      if (format === 'word') {
        await this.downloadWord(root, title);
        return;
      }
      await this.inlineImages(root);
      const html = htmlDocument(title, root.innerHTML);
      if (format === 'pdf') {
        this.print(html);
        return;
      }
      this.download(new Blob([html], { type: 'text/html' }), fileName(title, 'html'));
    } finally {
      root.remove();
    }
  }

  /**
   * Render the note offscreen with math and diagrams drawn.
   *
   * @param source - Markdown.
   * @returns Rendered root (attached to the page; remove after use).
   */
  private async render(source: string): Promise<HTMLElement> {
    const root = document.createElement('div');
    root.setAttribute('style', OFFSCREEN_STYLE);
    root.innerHTML = renderMarkdown(source);
    document.body.append(root);
    await enhanceMarkdown(root, false);
    return root;
  }

  /**
   * Replace image URLs by data URLs.
   *
   * @param root - Rendered root.
   */
  private async inlineImages(root: HTMLElement): Promise<void> {
    for (const image of root.querySelectorAll('img')) {
      const blob = await fetchImage(image.src);
      if (blob !== null) {
        image.src = await dataUrl(blob);
      }
    }
  }

  /**
   * Build and download a Word-readable MHTML document.
   *
   * @param root - Rendered root.
   * @param title - Title.
   */
  private async downloadWord(root: HTMLElement, title: string): Promise<void> {
    const parts: MhtmlPart[] = [];
    for (const [index, image] of [...root.querySelectorAll('img')].entries()) {
      const blob = await fetchImage(image.src);
      if (blob === null) {
        continue;
      }
      const location = `image${String(index)}.${blob.type.split('/')[1] ?? 'png'}`;
      const base64 = (await dataUrl(blob)).split(',')[1] ?? '';
      parts.push({ location, type: blob.type, base64 });
      image.src = location;
    }
    const html = htmlDocument(title, root.innerHTML);
    this.download(
      new Blob([this.mhtml(html, parts)], { type: 'application/msword' }),
      fileName(title, 'doc'),
    );
  }

  /**
   * MHTML container (HTML plus images) that Word and LibreOffice open.
   *
   * @param html - HTML document.
   * @param parts - Images.
   * @returns MHTML text.
   */
  private mhtml(html: string, parts: readonly MhtmlPart[]): string {
    const header = [
      'MIME-Version: 1.0',
      `Content-Type: multipart/related; boundary="${MHTML_BOUNDARY}"; type="text/html"`,
      '',
    ];
    const htmlPart = [
      `--${MHTML_BOUNDARY}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Location: note.html',
      '',
      html,
    ];
    const imageParts = parts.flatMap((part) => [
      `--${MHTML_BOUNDARY}`,
      `Content-Type: ${part.type}`,
      'Content-Transfer-Encoding: base64',
      `Content-Location: ${part.location}`,
      '',
      wrapBase64(part.base64),
    ]);
    return [...header, ...htmlPart, ...imageParts, `--${MHTML_BOUNDARY}--`, ''].join('\r\n');
  }

  /**
   * Print a document from a hidden frame (the browser offers "Save as PDF").
   *
   * @param html - HTML document.
   */
  private print(html: string): void {
    const frame = document.createElement('iframe');
    frame.setAttribute('style', 'position:fixed;width:0;height:0;border:0;');
    frame.srcdoc = html;
    frame.onload = () => {
      const view = frame.contentWindow;
      view?.addEventListener('afterprint', () => {
        frame.remove();
      });
      setTimeout(() => {
        view?.print();
      }, PRINT_DELAY_MS);
    };
    document.body.append(frame);
  }

  /**
   * Download a blob.
   *
   * @param blob - Content.
   * @param name - File name.
   */
  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    triggerDownload(url, name);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_DELAY_MS);
  }
}

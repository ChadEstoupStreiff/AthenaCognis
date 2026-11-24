import DOMPurify from 'dompurify';
import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { buildSharedPath, encodeFileSegment, guessMime } from '@domain/files';
import { backendUrl } from '../../core/api/api-client';
import { highlightCode } from './highlight';

/** Code languages rendered after the fact (diagrams), so left unhighlighted. */
const RENDERED_LANGUAGES: ReadonlySet<string> = new Set(['mermaid']);
const VIEWER_PREFIX = '/f/';
const VIEWER_SEGMENTS = 3;
const INTERNAL_EXCLUDED = ['/raw/', '/api/', '//'];
const CALLOUT_PATTERN = /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|<br>)*/gi;
const INLINE_MATH = /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/;
const BLOCK_MATH = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n|$)/;

/**
 * Escape text for HTML content or attributes.
 *
 * @param text - Raw text.
 * @returns Escaped text.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Math token produced by the KaTeX extensions. */
interface MathToken extends Tokens.Generic {
  readonly text: string;
}

/**
 * Math placeholder (typeset in the browser by `enhanceMarkdown`).
 *
 * @param tex - TeX source.
 * @param display - Display (block) math.
 * @returns HTML.
 */
function mathPlaceholder(tex: string, display: boolean): string {
  const tag = display ? 'div' : 'span';
  const kind = display ? 'math math-block' : 'math';
  return `<${tag} class="${kind}" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</${tag}>`;
}

const BLOCK_MATH_EXTENSION: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start: (source) => source.indexOf('$$'),
  tokenizer: (source) => {
    const match = BLOCK_MATH.exec(source);
    return match === null ? undefined : { type: 'blockMath', raw: match[0], text: match[1] ?? '' };
  },
  renderer: (token) => mathPlaceholder((token as MathToken).text.trim(), true),
};

const INLINE_MATH_EXTENSION: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (source) => source.indexOf('$'),
  tokenizer: (source) => {
    const match = INLINE_MATH.exec(source);
    return match === null ? undefined : { type: 'inlineMath', raw: match[0], text: match[1] ?? '' };
  },
  renderer: (token) => mathPlaceholder((token as MathToken).text, false),
};

/**
 * Shared path of an in-app viewer URL.
 *
 * @param href - `/f/<date>/<folder>/<name>` (encoded).
 * @returns Shared path, or `null`.
 */
function viewerPath(href: string): string | null {
  if (!href.startsWith(VIEWER_PREFIX)) {
    return null;
  }
  try {
    const segments = href.slice(VIEWER_PREFIX.length).split('/').map(decodeURIComponent);
    const [date, folder, name] = segments;
    const isComplete = [date, folder, name].every((part) => part !== undefined && part !== '');
    return segments.length === VIEWER_SEGMENTS && isComplete
      ? buildSharedPath({ date: date ?? '', folder: folder ?? '', name: name ?? '' })
      : null;
  } catch {
    return null;
  }
}

/**
 * Preview card of an embedded file (`![label](/f/…)`).
 *
 * @param href - Viewer URL.
 * @param label - Label.
 * @returns HTML, or `false` to render a plain image.
 */
function fileEmbed(href: string, label: string): string | false {
  const path = viewerPath(href);
  if (path === null) {
    return false;
  }
  const [, date, folder, name] = href.split('/');
  const isImage = guessMime(path).startsWith('image/');
  const thumbnail = isImage
    ? `/raw/${date ?? ''}/${folder ?? ''}/${name ?? ''}`
    : backendUrl(`/preview/${encodeFileSegment(path)}`);
  return (
    `<a class="file-embed" href="${escapeHtml(href)}">` +
    `<img class="file-embed-thumb" src="${escapeHtml(thumbnail)}" alt="">` +
    `<span class="file-embed-name"><i class="pi pi-file" aria-hidden="true"></i>${escapeHtml(label === '' ? decodeURIComponent(name ?? '') : label)}</span></a>`
  );
}

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight: (code, language) =>
      highlightCode(
        code,
        language === '' || RENDERED_LANGUAGES.has(language) ? 'plaintext' : language,
      ),
  }),
  { gfm: true, breaks: true },
  {
    extensions: [BLOCK_MATH_EXTENSION, INLINE_MATH_EXTENSION],
    renderer: {
      image: (token) => fileEmbed(token.href, token.text),
    },
  },
);

/**
 * Turn `> [!NOTE]` style blockquotes into callouts.
 *
 * @param html - Rendered HTML.
 * @returns HTML with callout classes and titles.
 */
function renderCallouts(html: string): string {
  return html.replaceAll(CALLOUT_PATTERN, (_match, type: string) => {
    const kind = type.toLowerCase();
    const title = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
    return `<blockquote class="callout callout-${kind}"><p class="callout-title">${title}</p><p>`;
  });
}

/**
 * Whether a link stays in the app (router navigation, same tab).
 *
 * @param href - Link target.
 * @returns `true` for app routes.
 */
export function isInternalLink(href: string): boolean {
  return href.startsWith('/') && !INTERNAL_EXCLUDED.some((prefix) => href.startsWith(prefix));
}

/** Inline style properties kept in rendered Markdown (notes toolbar colors and sizes). */
const ALLOWED_STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-align',
] as const;
const SAFE_STYLE_VALUE = /^[#\w\s.,%()-]+$/;
const UNSAFE_STYLE_VALUE = /url|expression|image/i;

/** Dedicated instance: the style hook must not affect other DOMPurify users (mail). */
const purifier = DOMPurify(window);
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLElement && node.hasAttribute('style')) {
    keepAllowedStyles(node);
  }
  if (node instanceof HTMLAnchorElement && !isInternalLink(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Reduce an element's inline style to the allowed properties with plain values.
 *
 * @param element - Sanitized element.
 */
function keepAllowedStyles(element: HTMLElement): void {
  const declarations = ALLOWED_STYLE_PROPERTIES.flatMap((property) => {
    const value = element.style.getPropertyValue(property).trim();
    const isSafe = SAFE_STYLE_VALUE.test(value) && !UNSAFE_STYLE_VALUE.test(value);
    return value !== '' && isSafe ? [`${property}: ${value}`] : [];
  });
  if (declarations.length === 0) {
    element.removeAttribute('style');
    return;
  }
  element.setAttribute('style', declarations.join('; '));
}

/**
 * Sanitize rendered HTML (external links open in a new tab).
 *
 * @param html - Rendered Markdown.
 * @returns Safe HTML.
 */
function sanitize(html: string): string {
  return purifier.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
}

/**
 * Render Markdown to sanitized HTML.
 *
 * @param source - Markdown text.
 * @returns Safe HTML.
 */
export function renderMarkdown(source: string): string {
  return sanitize(renderCallouts(marked.parse(source, { async: false })));
}

/**
 * Render one line of Markdown (emphasis, code, links; no blocks) to sanitized HTML.
 *
 * @param source - Markdown text.
 * @returns Safe HTML.
 */
export function renderInlineMarkdown(source: string): string {
  return sanitize(marked.parseInline(source, { async: false }));
}

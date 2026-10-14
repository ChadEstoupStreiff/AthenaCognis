import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { highlightCode } from './highlight';

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight: (code, language) => highlightCode(code, language === '' ? 'plaintext' : language),
  }),
  { gfm: true, breaks: true },
);

/**
 * Sanitize rendered HTML (links open in a new tab).
 *
 * @param html - Rendered Markdown.
 * @returns Safe HTML.
 */
function sanitize(html: string): string {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return clean.replaceAll('<a href=', '<a target="_blank" rel="noopener noreferrer" href=');
}

/**
 * Render Markdown to sanitized HTML.
 *
 * @param source - Markdown text.
 * @returns Safe HTML.
 */
export function renderMarkdown(source: string): string {
  return sanitize(marked.parse(source, { async: false }));
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

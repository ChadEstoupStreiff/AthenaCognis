import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  markdown,
  php,
  plaintext,
  python,
  r,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

/** Highlighting is skipped above this size (plain text stays responsive). */
const MAX_HIGHLIGHT_CHARS = 200_000;

/**
 * Escape text for HTML.
 *
 * @param text - Raw text.
 * @returns Escaped text.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Highlight source code (escaped HTML output).
 *
 * @param code - Source.
 * @param language - Language id (unknown ids fall back to plain text).
 * @returns HTML.
 */
export function highlightCode(code: string, language: string): string {
  if (code.length > MAX_HIGHLIGHT_CHARS) {
    return escapeHtml(code);
  }
  const known = hljs.getLanguage(language) === undefined ? 'plaintext' : language;
  return hljs.highlight(code, { language: known, ignoreIllegals: true }).value;
}

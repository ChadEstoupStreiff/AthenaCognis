/** One replacement in a document plus the selection to restore afterwards. */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selectFrom: number;
  readonly selectTo: number;
}

/** Block marker a line can carry. */
export type LineMarker = 'bullet' | 'ordered' | 'task' | 'quote';

const HEADING_PATTERN = /^#{1,6}\s+/;
const LIST_PATTERN = /^(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const QUOTE_PATTERN = /^>\s?/;
const MAX_HEADING_LEVEL = 6;
const URL_UNSAFE_CHARACTERS = /[()]/g;
const HEX_RADIX = 16;

const MARKER_PATTERNS: Readonly<Record<LineMarker, RegExp>> = {
  bullet: /^[-*+]\s+(?!\[[ xX]\])/,
  ordered: /^\d+[.)]\s+/,
  task: /^[-*+]\s+\[[ xX]\]\s+/,
  quote: QUOTE_PATTERN,
};

/**
 * Prefix of one line for a marker.
 *
 * @param marker - Marker.
 * @param index - Line index within the selection.
 * @returns Prefix text.
 */
function markerPrefix(marker: LineMarker, index: number): string {
  switch (marker) {
    case 'bullet':
      return '- ';
    case 'ordered':
      return `${String(index + 1)}. `;
    case 'task':
      return '- [ ] ';
    case 'quote':
      return '> ';
  }
}

/**
 * Bounds of the full lines touched by a selection.
 *
 * @param doc - Document.
 * @param from - Selection start.
 * @param to - Selection end.
 * @returns Start of the first line and end of the last line.
 */
function lineBounds(doc: string, from: number, to: number): { start: number; end: number } {
  const start = doc.lastIndexOf('\n', from - 1) + 1;
  const newline = doc.indexOf('\n', to);
  return { start, end: newline === -1 ? doc.length : newline };
}

/**
 * Replace the touched lines with a transformed version and select them.
 *
 * @param doc - Document.
 * @param from - Selection start.
 * @param to - Selection end.
 * @param transform - Maps the lines to their new text.
 * @returns Edit.
 */
function editLines(
  doc: string,
  from: number,
  to: number,
  transform: (lines: string[]) => string[],
): TextEdit {
  const { start, end } = lineBounds(doc, from, to);
  const insert = transform(doc.slice(start, end).split('\n')).join('\n');
  return { from: start, to: end, insert, selectFrom: start, selectTo: start + insert.length };
}

/**
 * Wrap the selection in markers, or unwrap it when it already is wrapped.
 *
 * @param doc - Document.
 * @param from - Selection start.
 * @param to - Selection end.
 * @param before - Opening marker.
 * @param after - Closing marker.
 * @param placeholder - Text inserted when nothing is selected.
 * @returns Edit.
 */
export function wrapSelection(
  doc: string,
  from: number,
  to: number,
  before: string,
  after: string,
  placeholder: string,
): TextEdit {
  const isWrapped =
    from !== to &&
    doc.slice(from - before.length, from) === before &&
    doc.slice(to, to + after.length) === after;
  if (isWrapped) {
    const inner = doc.slice(from, to);
    const start = from - before.length;
    return {
      from: start,
      to: to + after.length,
      insert: inner,
      selectFrom: start,
      selectTo: start + inner.length,
    };
  }
  const inner = from === to ? placeholder : doc.slice(from, to);
  const selectFrom = from + before.length;
  return {
    from,
    to,
    insert: `${before}${inner}${after}`,
    selectFrom,
    selectTo: selectFrom + inner.length,
  };
}

/**
 * Turn the touched lines into a heading of a level (0 = plain paragraph).
 *
 * @param doc - Document.
 * @param from - Selection start.
 * @param to - Selection end.
 * @param level - Heading level 0–6.
 * @returns Edit.
 * @throws RangeError when the level is out of range.
 */
export function setHeading(doc: string, from: number, to: number, level: number): TextEdit {
  if (!Number.isInteger(level) || level < 0 || level > MAX_HEADING_LEVEL) {
    throw new RangeError(`Heading level must be 0–${String(MAX_HEADING_LEVEL)}.`);
  }
  const prefix = level === 0 ? '' : `${'#'.repeat(level)} `;
  return editLines(doc, from, to, (lines) =>
    lines.map((line) => `${prefix}${line.replace(HEADING_PATTERN, '')}`),
  );
}

/**
 * Toggle a list or quote marker on the touched lines.
 *
 * @param doc - Document.
 * @param from - Selection start.
 * @param to - Selection end.
 * @param marker - Marker.
 * @returns Edit.
 */
export function toggleLineMarker(
  doc: string,
  from: number,
  to: number,
  marker: LineMarker,
): TextEdit {
  const strip = marker === 'quote' ? QUOTE_PATTERN : LIST_PATTERN;
  return editLines(doc, from, to, (lines) => {
    const isMarked = lines.every((line) => MARKER_PATTERNS[marker].test(line));
    return lines.map((line, index) => {
      const bare = line.replace(strip, '');
      return isMarked ? bare : `${markerPrefix(marker, index)}${bare}`;
    });
  });
}

/**
 * Insert a block on its own lines (blank line before and after), replacing the selection.
 *
 * @param doc - Document.
 * @param from - Selection start.
 * @param to - Selection end.
 * @param block - Block text.
 * @returns Edit with the cursor placed after the block.
 */
export function insertBlock(doc: string, from: number, to: number, block: string): TextEdit {
  const head = doc.slice(0, from);
  const tail = doc.slice(to);
  const before = head === '' || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n';
  const after = tail.startsWith('\n\n') ? '' : tail.startsWith('\n') ? '\n' : '\n\n';
  const insert = `${before}${block}${after}`;
  const cursor = from + before.length + block.length;
  return { from, to, insert, selectFrom: cursor, selectTo: cursor };
}

/**
 * Empty Markdown table with a header row.
 *
 * @param rows - Body rows (at least 1).
 * @param columns - Columns (at least 1).
 * @returns Table text.
 * @throws RangeError when a dimension is below 1.
 */
export function buildTable(rows: number, columns: number): string {
  if (rows < 1 || columns < 1) {
    throw new RangeError('A table needs at least one row and one column.');
  }
  const indexes = Array.from({ length: columns }, (_, index) => index + 1);
  const header = `| ${indexes.map((index) => `Column ${String(index)}`).join(' | ')} |`;
  const separator = `| ${indexes.map(() => '---').join(' | ')} |`;
  const body = Array.from({ length: rows }, () => `| ${indexes.map(() => ' ').join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

/**
 * Opening and closing tags of an inline styled span.
 *
 * @param property - CSS property (color, background-color, font-size).
 * @param value - CSS value.
 * @returns Opening and closing tags.
 */
export function styledSpan(property: string, value: string): { before: string; after: string } {
  return { before: `<span style="${property}: ${value}">`, after: '</span>' };
}

/**
 * Markdown image (URL parentheses escaped so the link stays intact).
 *
 * @param alt - Alternative text.
 * @param url - Image URL.
 * @returns Markdown.
 */
export function imageMarkdown(alt: string, url: string): string {
  const safeAlt = alt.replaceAll(/[[\]]/g, '');
  const safeUrl = url.replaceAll(
    URL_UNSAFE_CHARACTERS,
    (character) => `%${character.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`,
  );
  return `![${safeAlt}](${safeUrl})`;
}

/** Image found in a selection. */
export interface ImageRef {
  readonly alt: string;
  readonly url: string;
  readonly width: string | null;
  readonly caption: boolean;
}

const MARKDOWN_IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const HTML_IMAGE = /<img\b[^>]*>/i;
const FIGURE = /^<figure>[\s\S]*<\/figure>$/i;

/**
 * Value of an HTML attribute.
 *
 * @param tag - Tag text.
 * @param name - Attribute name.
 * @returns Unescaped value, or `null`.
 */
function attributeOf(tag: string, name: string): string | null {
  const value = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1];
  return value === undefined
    ? null
    : value
        .replaceAll('&quot;', '"')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
}

/**
 * Escape text for an HTML attribute or element.
 *
 * @param value - Raw value.
 * @returns Escaped value.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Parse a Markdown image, an `<img>` tag or a `<figure>` holding one.
 *
 * @param text - Selected text.
 * @returns Image, or `null` when the text is not a single image.
 */
export function parseImage(text: string): ImageRef | null {
  const trimmed = text.trim();
  const markdown = MARKDOWN_IMAGE.exec(trimmed);
  if (markdown !== null) {
    return { alt: markdown[1] ?? '', url: markdown[2] ?? '', width: null, caption: false };
  }
  const tag = HTML_IMAGE.exec(trimmed)?.[0];
  const url = tag === undefined ? null : attributeOf(tag, 'src');
  if (tag === undefined || url === null) {
    return null;
  }
  return {
    alt: attributeOf(tag, 'alt') ?? '',
    url,
    width: attributeOf(tag, 'width'),
    caption: FIGURE.test(trimmed),
  };
}

/**
 * Render an image as Markdown, or as HTML when it has a width or a caption.
 *
 * @param image - Image.
 * @returns Markdown or HTML.
 */
export function renderImage(image: ImageRef): string {
  if (image.width === null && !image.caption) {
    return imageMarkdown(image.alt, image.url);
  }
  const width = image.width === null ? '' : ` width="${escapeAttribute(image.width)}"`;
  const tag = `<img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt)}"${width}>`;
  return image.caption
    ? `<figure>${tag}<figcaption>${escapeAttribute(image.alt)}</figcaption></figure>`
    : tag;
}

/** Parsed BibTeX entry: lowercase field names, plus `ENTRYTYPE` and `ID` (like bibtexparser). */
export type BibtexRecord = Readonly<Record<string, string>>;

/** bibtexparser `common_strings`. */
const COMMON_STRINGS: Readonly<Record<string, string>> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};
const IGNORED_TYPES = new Set(['comment', 'preamble']);
const COMBINING_MARKS: Readonly<Record<string, string>> = {
  '`': '̀',
  "'": '́',
  '^': '̂',
  '~': '̃',
  '=': '̄',
  u: '̆',
  '.': '̇',
  '"': '̈',
  r: '̊',
  H: '̋',
  v: '̌',
  d: '̣',
  c: '̧',
  k: '̨',
  b: '̱',
};
const NAMED_SYMBOLS: Readonly<Record<string, string>> = {
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
  textendash: '–',
  textemdash: '—',
  textquoteright: '’',
  textquoteleft: '‘',
  textregistered: '®',
  texttrademark: '™',
  copyright: '©',
};
const SYMBOL_ACCENT = /\\([`'^~=."])\s*(?:\{\s*(\\?[A-Za-z])\s*\}|(\\?[A-Za-z]))/g;
const LETTER_ACCENT = /\\([uvHcdkbr])(?:\s*\{\s*(\\?[A-Za-z])\s*\}|\s+(\\?[A-Za-z]))/g;
const ESCAPED = /\\([&%$#_{}])/g;
const COMMAND = /\\([A-Za-z]+)\s*/g;
const OPEN_PLACEHOLDER = '\u0000';
const CLOSE_PLACEHOLDER = '\u0001';

/** Cursor over BibTeX text. */
class Reader {
  position = 0;

  /**
   * Create a reader.
   *
   * @param text - BibTeX text.
   */
  constructor(readonly text: string) {}

  /** Skip whitespace. */
  skipSpace(): void {
    while (/\s/.test(this.text.charAt(this.position))) {
      this.position += 1;
    }
  }

  /**
   * Read a word (type, key, field name, macro).
   *
   * @returns Word.
   */
  word(): string {
    this.skipSpace();
    const start = this.position;
    while (
      this.position < this.text.length &&
      !/[\s,={}()"#]/.test(this.text.charAt(this.position))
    ) {
      this.position += 1;
    }
    return this.text.slice(start, this.position);
  }

  /**
   * Consume a character if present.
   *
   * @param char - Expected character.
   * @returns Whether it was there.
   */
  accept(char: string): boolean {
    this.skipSpace();
    if (this.text.charAt(this.position) !== char) {
      return false;
    }
    this.position += 1;
    return true;
  }

  /**
   * Read a balanced `{…}` group (outer braces excluded).
   *
   * @returns Content.
   */
  braced(): string {
    const start = this.position;
    let depth = 1;
    while (this.position < this.text.length && depth > 0) {
      const char = this.text.charAt(this.position);
      depth += char === '{' ? 1 : char === '}' ? -1 : 0;
      this.position += 1;
    }
    return this.text.slice(start, this.position - 1);
  }

  /**
   * Read a `"…"` string (braces may protect quotes).
   *
   * @returns Content.
   */
  quoted(): string {
    const start = this.position;
    let depth = 0;
    while (this.position < this.text.length) {
      const char = this.text.charAt(this.position);
      if (char === '"' && depth === 0) {
        break;
      }
      depth += char === '{' ? 1 : char === '}' ? -1 : 0;
      this.position += 1;
    }
    this.position += 1;
    return this.text.slice(start, this.position - 1);
  }
}

/**
 * Read one value part: braced, quoted, number or macro.
 *
 * @param reader - Reader.
 * @param strings - Macros.
 * @returns Value.
 */
function valuePart(reader: Reader, strings: Map<string, string>): string {
  if (reader.accept('{')) {
    return reader.braced();
  }
  if (reader.accept('"')) {
    return reader.quoted();
  }
  const word = reader.word();
  return /^\d+$/.test(word) ? word : (strings.get(word.toLowerCase()) ?? word);
}

/**
 * Read a value with `#` concatenation.
 *
 * @param reader - Reader.
 * @param strings - Macros.
 * @returns Value.
 */
function readValue(reader: Reader, strings: Map<string, string>): string {
  let value = valuePart(reader, strings);
  while (reader.accept('#')) {
    value += valuePart(reader, strings);
  }
  return value;
}

/**
 * Read `name = value` pairs until the entry closes.
 *
 * @param reader - Reader.
 * @param strings - Macros.
 * @param close - Closing character.
 * @returns Fields.
 */
function readFields(
  reader: Reader,
  strings: Map<string, string>,
  close: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  while (reader.position < reader.text.length && !reader.accept(close)) {
    const name = reader.word().toLowerCase();
    if (name === '' || !reader.accept('=')) {
      reader.position += 1;
      continue;
    }
    fields[name] = readValue(reader, strings);
    reader.accept(',');
  }
  return fields;
}

/**
 * Read one `@type{…}` block.
 *
 * @param reader - Reader positioned after `@`.
 * @param strings - Macros (updated by `@string`).
 * @returns Entry, or null for strings/comments.
 */
function readEntry(reader: Reader, strings: Map<string, string>): BibtexRecord | null {
  const type = reader.word().toLowerCase();
  const close = reader.accept('{') ? '}' : reader.accept('(') ? ')' : '';
  if (close === '' || IGNORED_TYPES.has(type)) {
    if (close === '}') {
      reader.braced();
    }
    return null;
  }
  if (type === 'string') {
    for (const [name, value] of Object.entries(readFields(reader, strings, close))) {
      strings.set(name, value);
    }
    return null;
  }
  const id = reader.word();
  reader.accept(',');
  const fields = readFields(reader, strings, close);
  return {
    ...Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [name, latexToUnicode(value)]),
    ),
    ENTRYTYPE: type,
    ID: id,
  };
}

/**
 * Parse a BibTeX document.
 *
 * @param text - BibTeX content.
 * @returns Entries.
 */
export function parseBibtexRecords(text: string): BibtexRecord[] {
  const reader = new Reader(text);
  const strings = new Map(Object.entries(COMMON_STRINGS));
  const records: BibtexRecord[] = [];
  for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', reader.position)) {
    reader.position = at + 1;
    const record = readEntry(reader, strings);
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

/**
 * Accent a letter.
 *
 * @param accent - LaTeX accent command.
 * @param letter - Letter (or `\i`, `\j`).
 * @returns Composed character.
 */
function accented(accent: string, letter: string): string {
  const base = letter === '\\i' ? 'i' : letter === '\\j' ? 'j' : letter;
  return `${base}${COMBINING_MARKS[accent] ?? ''}`.normalize('NFC');
}

/**
 * Convert LaTeX markup to Unicode (accents, symbols, escapes), dropping braces like `convert_to_unicode`.
 *
 * @param value - Field value.
 * @returns Plain text.
 */
export function latexToUnicode(value: string): string {
  if (!value.includes('\\') && !value.includes('{')) {
    return value;
  }
  return value
    .replace(SYMBOL_ACCENT, (_, accent: string, braced?: string, bare?: string) =>
      accented(accent, braced ?? bare ?? ''),
    )
    .replace(LETTER_ACCENT, (_, accent: string, braced?: string, bare?: string) =>
      accented(accent, braced ?? bare ?? ''),
    )
    .replace(ESCAPED, (_, char: string) =>
      char === '{' ? OPEN_PLACEHOLDER : char === '}' ? CLOSE_PLACEHOLDER : char,
    )
    .replace(COMMAND, (_, name: string) => NAMED_SYMBOLS[name] ?? '')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replaceAll(OPEN_PLACEHOLDER, '{')
    .replaceAll(CLOSE_PLACEHOLDER, '}')
    .normalize('NFC');
}

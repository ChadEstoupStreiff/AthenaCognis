/** One source line with its fence state. */
export interface SourceLine {
  readonly text: string;
  /** 1-based line number. */
  readonly number: number;
  /** Offset of the line start in the document. */
  readonly from: number;
  /** Inside a fenced code block (fence lines included). */
  readonly inFence: boolean;
}

/** ATX heading of the document. */
export interface Heading {
  readonly level: number;
  readonly text: string;
  /** 1-based line number. */
  readonly line: number;
}

/** Size of a note. */
export interface TextStats {
  readonly words: number;
  readonly characters: number;
  readonly readingMinutes: number;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_PATTERN = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
const INLINE_MARKUP = /[*_~`]|<[^>]+>/g;
const LINK_PATTERN = /!?\[([^\]]*)\]\([^)]*\)/g;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const WORDS_PER_MINUTE = 220;

/**
 * Split a document into lines, flagging fenced code.
 *
 * @param doc - Markdown.
 * @returns Lines.
 */
export function scanLines(doc: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let fence: string | null = null;
  let offset = 0;
  doc.split('\n').forEach((text, index) => {
    const marker = FENCE_PATTERN.exec(text)?.[1];
    const isFenceLine = marker !== undefined && (fence === null || marker.startsWith(fence));
    lines.push({ text, number: index + 1, from: offset, inFence: fence !== null || isFenceLine });
    if (isFenceLine) {
      fence = fence === null ? (marker[0] ?? '`').repeat(marker.length) : null;
    }
    offset += text.length + 1;
  });
  return lines;
}

/**
 * Plain text of an inline Markdown run (links keep their label).
 *
 * @param text - Markdown.
 * @returns Text.
 */
export function plainInline(text: string): string {
  return text.replaceAll(LINK_PATTERN, '$1').replaceAll(INLINE_MARKUP, '').trim();
}

/**
 * ATX headings outside code blocks.
 *
 * @param doc - Markdown.
 * @returns Headings in document order.
 */
export function extractHeadings(doc: string): Heading[] {
  return scanLines(doc).flatMap((line) => {
    const match = line.inFence ? null : HEADING_PATTERN.exec(line.text);
    const hashes = match?.[1];
    if (hashes === undefined) {
      return [];
    }
    return [{ level: hashes.length, text: plainInline(match?.[2] ?? ''), line: line.number }];
  });
}

/**
 * Flip the checkbox of the nth task item (document order, code blocks skipped).
 *
 * @param doc - Markdown.
 * @param index - 0-based task index.
 * @returns New document (unchanged when the task does not exist).
 */
export function toggleTask(doc: string, index: number): string {
  const tasks = scanLines(doc).filter((line) => !line.inFence && TASK_PATTERN.test(line.text));
  const task = tasks[index];
  if (task === undefined) {
    return doc;
  }
  const toggled = task.text.replace(
    TASK_PATTERN,
    (_match, open: string, state: string, close: string) =>
      `${open}${state === ' ' ? 'x' : ' '}${close}`,
  );
  return doc.slice(0, task.from) + toggled + doc.slice(task.from + task.text.length);
}

/**
 * Word, character and reading-time counts.
 *
 * @param doc - Markdown.
 * @returns Stats.
 */
export function textStats(doc: string): TextStats {
  const words = plainInline(doc).match(WORD_PATTERN)?.length ?? 0;
  return {
    words,
    characters: doc.length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

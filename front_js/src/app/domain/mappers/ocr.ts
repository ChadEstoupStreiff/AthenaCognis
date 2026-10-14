import type { OcrBox, ParsedOcr } from '../contracts/jobs';

const NORMALIZED_LIMIT = 1.05;
const MIN_BOX_VALUES = 4;
const POINT_SIZE = 2;

/** Corner coordinates of a box. */
type Corners = readonly [number, number, number, number];

/**
 * Check a value is a finite number.
 *
 * @param value - Candidate.
 * @returns `true` for finite numbers.
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Check a value is an `[x, y]` point.
 *
 * @param value - Candidate.
 * @returns `true` for numeric pairs.
 */
function isPoint(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === POINT_SIZE && value.every(isNumber);
}

/**
 * Reduce `[x1, y1, x2, y2]` or a polygon `[[x, y], ...]` to corners (port of `_bbox_from_any`).
 *
 * @param raw - Raw box.
 * @returns Corners, or `null` when the shape is unknown.
 */
function cornersOf(raw: unknown): Corners | null {
  if (!Array.isArray(raw) || raw.length < MIN_BOX_VALUES) {
    return null;
  }
  if (raw.every(isPoint)) {
    const xs = raw.map((point) => point[0]);
    const ys = raw.map((point) => point[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  const [x1, y1, x2, y2] = raw as unknown[];
  return isNumber(x1) && isNumber(y1) && isNumber(x2) && isNumber(y2) ? [x1, y1, x2, y2] : null;
}

/** Fields of one OCR item. */
interface OcrFields {
  readonly box: unknown;
  readonly text: string;
  readonly score: number | null;
}

/**
 * Convert a scalar to text.
 *
 * @param value - Candidate.
 * @returns The text (empty for non-scalars).
 */
function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Convert a score (number or numeric string) to a number.
 *
 * @param value - Candidate.
 * @returns The score, or `null`.
 */
function asScore(value: unknown): number | null {
  const score = typeof value === 'string' ? Number.parseFloat(value) : value;
  return isNumber(score) ? score : null;
}

/**
 * Read a PaddleOCR item `[bbox, [text, score]]`.
 *
 * @param item - Raw item.
 * @returns The fields.
 */
function arrayFields(item: readonly unknown[]): OcrFields {
  const [box, label] = item;
  const [text, score] = Array.isArray(label) ? (label as unknown[]) : [label, null];
  return { box, text: asText(text), score: asScore(score) };
}

/**
 * Read a dict item `{bbox|poly|box, text, score}`.
 *
 * @param item - Raw item.
 * @returns The fields.
 */
function recordFields(item: unknown): OcrFields {
  const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
  return {
    box: record['bbox'] ?? record['poly'] ?? record['box'] ?? null,
    text: asText(record['text']),
    score: asScore(record['score']),
  };
}

/**
 * Read the box, text and score of one OCR item.
 *
 * @param item - Raw OCR item.
 * @returns The fields.
 */
function fieldsOf(item: unknown): OcrFields {
  return Array.isArray(item) ? arrayFields(item) : recordFields(item);
}

/**
 * Convert one raw OCR item into a display box.
 *
 * @param item - Raw OCR item.
 * @returns The box, or `null` when it has no usable text.
 */
function toBox(item: unknown): OcrBox | null {
  const { box, text, score } = fieldsOf(item);
  if (text.trim() === '') {
    return null;
  }
  const corners = cornersOf(box) ?? [0, 0, 1, 1];
  const normalized = Math.max(...corners) <= NORMALIZED_LIMIT;
  const [x1, y1, x2, y2] = corners;
  return { text, score, x1, y1, x2, y2, normalized };
}

/**
 * Parse the backend OCR value: PaddleOCR JSON (boxes) or plain text from an LLM.
 *
 * @param raw - `ocr` field of `GET /ocr/get/{file}`.
 * @returns Text and boxes.
 */
export function parseOcr(raw: string | null | undefined): ParsedOcr {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return { text: '', boxes: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { text: value, boxes: [] };
  }
  if (!Array.isArray(parsed)) {
    return { text: value, boxes: [] };
  }
  const boxes = parsed.map(toBox).filter((box): box is OcrBox => box !== null);
  return { text: boxes.map((box) => box.text).join('\n'), boxes };
}

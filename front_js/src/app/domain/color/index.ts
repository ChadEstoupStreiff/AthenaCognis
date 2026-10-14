const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_RADIX = 16;
const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const LUMINANCE_THRESHOLD = 128;
const DARK_TEXT = '#000000';
const LIGHT_TEXT = '#ffffff';
const RED_OFFSET = 0;
const GREEN_OFFSET = 2;
const BLUE_OFFSET = 4;
const CHANNEL_LENGTH = 2;

/** Fixed palette used when an entity has no stored color. */
export const FALLBACK_PALETTE: readonly string[] = [
  '#7700a7',
  '#2563eb',
  '#0891b2',
  '#059669',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#475569',
  '#0d9488',
];

/**
 * Hash a string with 32-bit FNV-1a (stable across reloads and processes).
 *
 * @param text - Input string.
 * @returns Unsigned 32-bit hash.
 */
export function fnv1a(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * Pick a deterministic palette color for a name.
 *
 * @param name - Entity name (tag, project, contact).
 * @returns A hex color from {@link FALLBACK_PALETTE}.
 */
export function colorForName(name: string): string {
  const index = fnv1a(name) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[index] ?? DARK_TEXT;
}

/**
 * Normalize a stored color to `#rrggbb` (the backend sometimes omits the `#`).
 *
 * @param color - Raw color value.
 * @returns The lower-cased hex color, or `null` when the value is not a 6-digit hex color.
 */
export function normalizeHexColor(color: string | null | undefined): string | null {
  const match = HEX_COLOR_PATTERN.exec(color?.trim() ?? '');
  const digits = match?.[1];
  return digits === undefined ? null : `#${digits.toLowerCase()}`;
}

/**
 * Choose black or white text for a background, using the Streamlit front's luminance rule.
 *
 * @param background - Background hex color.
 * @returns `#000000` for light backgrounds, `#ffffff` for dark ones.
 */
export function readableTextColor(background: string): string {
  const hex = normalizeHexColor(background);
  if (hex === null) {
    return DARK_TEXT;
  }
  const channel = (offset: number): number =>
    Number.parseInt(hex.slice(1 + offset, 1 + offset + CHANNEL_LENGTH), HEX_RADIX);
  const luminance =
    RED_WEIGHT * channel(RED_OFFSET) +
    GREEN_WEIGHT * channel(GREEN_OFFSET) +
    BLUE_WEIGHT * channel(BLUE_OFFSET);
  return luminance > LUMINANCE_THRESHOLD ? DARK_TEXT : LIGHT_TEXT;
}

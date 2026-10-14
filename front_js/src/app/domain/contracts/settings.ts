/** JSON value stored in a backend setting. */
export type SettingValue =
  string | number | boolean | null | readonly unknown[] | Readonly<Record<string, unknown>>;

/** Suffix of settings holding provider API keys. */
export const API_KEY_SUFFIX = '_api_key';

const JSON_LOOKING = /^[[{]/;

/**
 * Protect strings the backend would store as JSON (`[Draft] …` would otherwise become unreadable).
 * The backend trims strings, so the leading space disappears on storage.
 *
 * @param value - Value to store.
 * @returns The value to send.
 */
export function guardSettingValue(value: SettingValue): SettingValue {
  return typeof value === 'string' && JSON_LOOKING.test(value) ? ` ${value}` : value;
}

/** Representation modes of file collections. */
export type RepresentationMode = 'cards' | 'list' | 'table';

/** Stored integer of each representation mode (`0: grid, 1: list, 2: table` in the backend defaults). */
export const REPRESENTATION_MODES: readonly RepresentationMode[] = ['cards', 'list', 'table'];

/**
 * Convert the stored integer into a representation mode.
 *
 * @param value - Stored setting value.
 * @returns The mode (`list` when unknown).
 */
export function representationModeOf(value: unknown): RepresentationMode {
  return typeof value === 'number' ? (REPRESENTATION_MODES[value] ?? 'list') : 'list';
}

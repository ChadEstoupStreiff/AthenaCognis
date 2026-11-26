/** Setting holding the user-defined providers (read by `back/src/tools/custom_providers.py`). */
export const CUSTOM_PROVIDERS_KEY = 'custom_providers';

const ID_PREFIX = 'custom:';
const BASE_URL_PATTERN = /^https?:\/\/[^\s/]+\S*$/i;
const ID_RADIX = 36;

/** One OpenAI-compatible provider, stored as is. */
export interface CustomProvider {
  readonly id: string;
  readonly name: string;
  readonly base_url: string;
  readonly api_key: string;
}

/** Fields the user types. */
export type CustomProviderDraft = Omit<CustomProvider, 'id'>;

export const EMPTY_DRAFT: CustomProviderDraft = { name: '', base_url: '', api_key: '' };

/**
 * Whether a provider value names a user-defined provider.
 *
 * @param value - Value of a `<task>_type` setting.
 * @returns True for a custom provider.
 */
export function isCustomProvider(value: string): boolean {
  return value.startsWith(ID_PREFIX);
}

/**
 * Whether a stored item has every field of a provider.
 *
 * @param item - Stored item.
 * @returns True when complete.
 */
function isStoredProvider(item: unknown): item is CustomProvider {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return ['id', 'name', 'base_url', 'api_key'].every((key) => typeof record[key] === 'string');
}

/**
 * Read the stored provider list.
 *
 * @param value - Setting value.
 * @returns Complete providers.
 */
export function parseCustomProviders(value: unknown): CustomProvider[] {
  return Array.isArray(value) ? value.filter(isStoredProvider) : [];
}

/**
 * First problem of a typed provider.
 *
 * @param draft - Typed fields.
 * @returns Message, or null when it can be saved.
 */
export function draftError(draft: CustomProviderDraft): string | null {
  if (draft.name.trim() === '' || draft.api_key.trim() === '') {
    return 'Name, base URL and API key are required.';
  }
  return BASE_URL_PATTERN.test(draft.base_url.trim())
    ? null
    : 'The base URL must start with http:// or https://.';
}

/**
 * Identifier of a new provider (never reused, so deleted providers stay deleted).
 *
 * @param name - Provider name.
 * @param now - Timestamp in milliseconds.
 * @returns Identifier.
 */
export function newProviderId(name: string, now: number): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `${ID_PREFIX}${slug}-${now.toString(ID_RADIX)}`;
}

/**
 * Add a provider, or replace the one with the same identifier.
 *
 * @param providers - Current providers.
 * @param id - Identifier.
 * @param draft - Typed fields.
 * @returns New list.
 */
export function upsertProvider(
  providers: readonly CustomProvider[],
  id: string,
  draft: CustomProviderDraft,
): CustomProvider[] {
  const saved: CustomProvider = {
    id,
    name: draft.name.trim(),
    base_url: draft.base_url.trim().replace(/\/+$/, ''),
    api_key: draft.api_key.trim(),
  };
  return providers.some((provider) => provider.id === id)
    ? providers.map((provider) => (provider.id === id ? saved : provider))
    : [...providers, saved];
}

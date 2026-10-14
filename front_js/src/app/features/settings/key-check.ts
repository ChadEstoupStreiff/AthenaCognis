/** Outcome of an API key check. */
export type KeyCheck = 'valid' | 'invalid' | 'unreachable';

/** Provider endpoint that lists models (cheap authenticated call). */
interface KeyProbe {
  readonly url: (key: string) => string;
  readonly headers: (key: string) => Record<string, string>;
}

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

const PROBES: Readonly<Record<string, KeyProbe>> = {
  mistral_api_key: { url: () => 'https://api.mistral.ai/v1/models', headers: bearer },
  openai_api_key: { url: () => 'https://api.openai.com/v1/models', headers: bearer },
  groq_api_key: { url: () => 'https://api.groq.com/openai/v1/models', headers: bearer },
  gemini_api_key: {
    url: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: () => ({}),
  },
  anthropic_api_key: {
    url: () => 'https://api.anthropic.com/v1/models',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
  },
};

/**
 * Check an API key from the browser by listing the provider's models.
 *
 * @param setting - API key setting name.
 * @param key - Key value.
 * @returns Validity, or `unreachable` when the provider blocks browser calls or is offline.
 */
export async function checkApiKey(setting: string, key: string): Promise<KeyCheck> {
  const probe = PROBES[setting];
  if (probe === undefined || key.trim() === '') {
    return 'invalid';
  }
  try {
    const response = await fetch(probe.url(key.trim()), { headers: probe.headers(key.trim()) });
    return response.ok ? 'valid' : 'invalid';
  } catch {
    return 'unreachable';
  }
}

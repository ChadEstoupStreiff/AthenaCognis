/** How a task picks its model. */
export type TaskKind = 'text' | 'vision' | 'transcription';

/** One AI task configured by `<key>_type` / `<key>_model` settings. */
export interface AiTask {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly kind: TaskKind;
  /** Provider value meaning "run locally" (vision tasks). */
  readonly localKey?: string;
  readonly localLabel?: string;
}

/** Provider option. */
export interface ProviderOption {
  readonly value: string;
  readonly label: string;
}

/** Every AI task of the backend (setting key prefixes). */
export const AI_TASKS: readonly AiTask[] = [
  { key: 'chat', label: 'Assistant', hint: 'Conversations', kind: 'text' },
  { key: 'refractor', label: 'Rewrite', hint: 'AI buttons under text areas', kind: 'text' },
  { key: 'link', label: 'Auto-link', hint: 'Relation suggestions between files', kind: 'text' },
  {
    key: 'research',
    label: 'Paper search',
    hint: 'AI search in Research → Discover related',
    kind: 'text',
  },
  {
    key: 'summarization',
    label: 'Summaries',
    hint: 'Summary and keywords of every file',
    kind: 'text',
  },
  {
    key: 'blip',
    label: 'Image captions',
    hint: 'Describes images',
    kind: 'vision',
    localKey: 'local',
    localLabel: 'Local BLIP',
  },
  {
    key: 'ocr',
    label: 'Text in images',
    hint: 'OCR',
    kind: 'vision',
    localKey: 'paddle',
    localLabel: 'Local PaddleOCR',
  },
  {
    key: 'transcription',
    label: 'Transcription',
    hint: 'Audio and video to text',
    kind: 'transcription',
  },
];

/** Text providers (values stored by the Streamlit front). */
export const TEXT_PROVIDERS: readonly ProviderOption[] = [
  { value: 'llama', label: 'Ollama (local)' },
  { value: 'Mistral', label: 'Mistral' },
  { value: 'ChatGPT', label: 'OpenAI' },
  { value: 'Gemini', label: 'Gemini' },
  { value: 'Claude', label: 'Claude' },
  { value: 'DeepSeek', label: 'DeepSeek' },
  { value: 'Groq', label: 'Groq' },
];

/** Text providers without image support in the vision tasks (captions, OCR). */
const TEXT_ONLY_PROVIDERS = new Set(['DeepSeek', 'Groq']);

/** Providers of the vision tasks. */
const VISION_PROVIDERS: readonly ProviderOption[] = TEXT_PROVIDERS.filter(
  (provider) => !TEXT_ONLY_PROVIDERS.has(provider.value),
);

/** Transcription providers. */
export const TRANSCRIPTION_PROVIDERS: readonly ProviderOption[] = [
  { value: 'local', label: 'Local (faster-whisper)' },
  { value: 'openai', label: 'OpenAI Whisper' },
  { value: 'groq', label: 'Groq Whisper' },
];

const TEXT_MODELS: Readonly<Record<string, readonly string[]>> = {
  Mistral: [
    'ministral-3b-latest',
    'ministral-8b-latest',
    'mistral-small-latest',
    'mistral-medium-latest',
    'mistral-large-latest',
    'magistral-small-latest',
    'magistral-medium-latest',
  ],
  ChatGPT: [
    'gpt-4.1-nano',
    'gpt-4.1-mini',
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'gpt-4.1',
    'gpt-4o',
    'gpt-4',
  ],
  Gemini: [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  Claude: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-fable-5'],
  DeepSeek: ['deepseek-chat', 'deepseek-reasoner'],
  Groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2-instruct',
    'qwen/qwen3-32b',
  ],
};

const VISION_MODELS: Readonly<Record<string, readonly string[]>> = {
  Mistral: ['pixtral-12b-2409', 'pixtral-large-2411'],
  ChatGPT: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1'],
  Gemini: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  Claude: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
};

const TRANSCRIPTION_MODELS: Readonly<Record<string, readonly string[]>> = {
  local: ['tiny', 'base', 'small', 'medium', 'large-v3'],
  openai: ['whisper-1'],
  groq: ['whisper-large-v3', 'whisper-large-v3-turbo'],
};

const VISION_TAGS = ['llava', 'moondream', 'bakllava', 'minicpm', 'vision'];

/** Built-in model lists, used until the live lists are loaded or when a provider fails. */
const BUILT_IN_MODELS: Readonly<Record<TaskKind, Readonly<Record<string, readonly string[]>>>> = {
  text: TEXT_MODELS,
  vision: VISION_MODELS,
  transcription: TRANSCRIPTION_MODELS,
};

/** Live models of one provider (`GET /ai/models`). */
export interface RemoteModels {
  readonly text: readonly string[];
  readonly vision: readonly string[];
  readonly transcription: readonly string[];
  /** Why the list is unknown (no key, key rejected…), null when loaded. */
  readonly error: string | null;
}

/** Live models per provider value (`<task>_type` setting). */
export type RemoteCatalog = Readonly<Record<string, RemoteModels>>;

/**
 * Strings of an unknown array.
 *
 * @param value - Value.
 * @returns Strings (empty when not an array).
 */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Validate a `GET /ai/models` answer (malformed entries dropped).
 *
 * @param raw - Body.
 * @returns Catalog.
 */
export function parseRemoteCatalog(raw: unknown): RemoteCatalog {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, Record<string, unknown>] => {
      const value = entry[1];
      return typeof value === 'object' && value !== null;
    })
    .map(([provider, value]): [string, RemoteModels] => [
      provider,
      {
        text: stringsOf(value['text']),
        vision: stringsOf(value['vision']),
        transcription: stringsOf(value['transcription']),
        error: typeof value['error'] === 'string' ? value['error'] : null,
      },
    ]);
  return Object.fromEntries(entries);
}

/**
 * Number of distinct models of a provider.
 *
 * @param models - Live models.
 * @returns Count.
 */
export function modelCount(models: RemoteModels): number {
  return new Set([...models.text, ...models.vision, ...models.transcription]).size;
}

/**
 * Providers available for a task.
 *
 * @param task - Task.
 * @returns Providers.
 */
export function providersFor(task: AiTask): readonly ProviderOption[] {
  if (task.kind === 'transcription') {
    return TRANSCRIPTION_PROVIDERS;
  }
  if (task.kind === 'vision' && task.localKey !== undefined) {
    return [{ value: task.localKey, label: task.localLabel ?? 'Local' }, ...VISION_PROVIDERS];
  }
  return TEXT_PROVIDERS;
}

/**
 * Models selectable for a task and provider.
 *
 * @param task - Task.
 * @param provider - Provider value.
 * @param installed - Installed Ollama models.
 * @param remote - Live lists (built-in list used when missing, failed or empty).
 * @returns Model names (empty for local vision engines, which have no model choice).
 */
export function modelsFor(
  task: AiTask,
  provider: string,
  installed: readonly string[],
  remote: RemoteCatalog = {},
): readonly string[] {
  if (provider === 'llama' && task.kind !== 'transcription') {
    const vision = installed.filter((model) => VISION_TAGS.some((tag) => model.includes(tag)));
    return task.kind === 'vision' && vision.length > 0 ? vision : installed;
  }
  if (provider === task.localKey) {
    return [];
  }
  const live = liveModels(remote[provider], task.kind);
  return live.length > 0 ? live : (BUILT_IN_MODELS[task.kind][provider] ?? []);
}

/**
 * Live models of a provider for a task kind.
 *
 * @param models - Live lists of the provider, if loaded.
 * @param kind - Task kind.
 * @returns Models (empty when not loaded or failed).
 */
function liveModels(models: RemoteModels | undefined, kind: TaskKind): readonly string[] {
  return models?.error === null ? models[kind] : [];
}

/** API-key settings, with the provider they unlock. */
export const API_KEYS: readonly {
  readonly key: string;
  readonly label: string;
  /** Where to create a key. */
  readonly url: string;
  /** Provider's description of its models. */
  readonly modelsUrl: string;
  /** Provider value whose live model list this key unlocks. */
  readonly provider: string;
}[] = [
  {
    key: 'mistral_api_key',
    label: 'Mistral',
    url: 'https://console.mistral.ai/api-keys',
    modelsUrl: 'https://docs.mistral.ai/getting-started/models/',
    provider: 'Mistral',
  },
  {
    key: 'openai_api_key',
    label: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    modelsUrl: 'https://platform.openai.com/docs/models',
    provider: 'ChatGPT',
  },
  {
    key: 'gemini_api_key',
    label: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    provider: 'Gemini',
  },
  {
    key: 'groq_api_key',
    label: 'Groq',
    url: 'https://console.groq.com/keys',
    modelsUrl: 'https://console.groq.com/docs/models',
    provider: 'Groq',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic Claude',
    url: 'https://console.anthropic.com/settings/keys',
    modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    provider: 'Claude',
  },
  {
    key: 'deepseek_api_key',
    label: 'DeepSeek',
    url: 'https://platform.deepseek.com/api_keys',
    modelsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    provider: 'DeepSeek',
  },
];

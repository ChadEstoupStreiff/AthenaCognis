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
];

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
    return [{ value: task.localKey, label: task.localLabel ?? 'Local' }, ...TEXT_PROVIDERS];
  }
  return TEXT_PROVIDERS;
}

/**
 * Models selectable for a task and provider.
 *
 * @param task - Task.
 * @param provider - Provider value.
 * @param installed - Installed Ollama models.
 * @returns Model names (empty for local vision engines, which have no model choice).
 */
export function modelsFor(
  task: AiTask,
  provider: string,
  installed: readonly string[],
): readonly string[] {
  if (task.kind === 'transcription') {
    return TRANSCRIPTION_MODELS[provider] ?? [];
  }
  if (provider === 'llama') {
    const vision = installed.filter((model) => VISION_TAGS.some((tag) => model.includes(tag)));
    return task.kind === 'vision' && vision.length > 0 ? vision : installed;
  }
  if (provider === task.localKey) {
    return [];
  }
  return (task.kind === 'vision' ? VISION_MODELS : TEXT_MODELS)[provider] ?? [];
}

/** API-key settings, with the provider they unlock. */
export const API_KEYS: readonly {
  readonly key: string;
  readonly label: string;
  readonly url: string;
}[] = [
  { key: 'mistral_api_key', label: 'Mistral', url: 'https://console.mistral.ai/api-keys' },
  { key: 'openai_api_key', label: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
  { key: 'gemini_api_key', label: 'Google Gemini', url: 'https://aistudio.google.com/apikey' },
  { key: 'groq_api_key', label: 'Groq (Whisper)', url: 'https://console.groq.com/keys' },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic Claude',
    url: 'https://console.anthropic.com/settings/keys',
  },
];

import {
  AI_TASKS,
  type AiTask,
  modelCount,
  modelsFor,
  parseRemoteCatalog,
  providersFor,
} from './ai-routing';

const task = (key: string): AiTask => AI_TASKS.find((item) => item.key === key)!;

describe('AI routing', () => {
  it('offers local engines for vision tasks', () => {
    expect(providersFor(task('ocr'))[0]).toEqual({ value: 'paddle', label: 'Local PaddleOCR' });
    expect(providersFor(task('chat')).map((provider) => provider.value)).toContain('Claude');
    expect(providersFor(task('chat')).map((provider) => provider.value)).toContain('DeepSeek');
    expect(providersFor(task('blip')).map((provider) => provider.value)).not.toContain('DeepSeek');
    expect(providersFor(task('chat')).map((provider) => provider.value)).toContain('Groq');
    expect(providersFor(task('ocr')).map((provider) => provider.value)).not.toContain('Groq');
  });

  it('lists models per provider', () => {
    expect(modelsFor(task('chat'), 'llama', ['llama3.2:1b'])).toEqual(['llama3.2:1b']);
    expect(modelsFor(task('blip'), 'llama', ['llama3.2:1b', 'llava:7b'])).toEqual(['llava:7b']);
    expect(modelsFor(task('ocr'), 'paddle', [])).toEqual([]);
    expect(modelsFor(task('transcription'), 'groq', [])).toContain('whisper-large-v3-turbo');
  });

  it('prefers live lists and falls back to built-in ones', () => {
    const remote = parseRemoteCatalog({
      Claude: { text: ['claude-new'], vision: ['claude-new'], transcription: [], error: null },
      Mistral: { text: [], vision: [], transcription: [], error: 'No API key' },
      groq: { text: [], vision: [], transcription: ['whisper-x'], error: null },
      ChatGPT: { text: [], vision: [], transcription: [], error: null },
    });
    expect(modelsFor(task('chat'), 'Claude', [], remote)).toEqual(['claude-new']);
    expect(modelsFor(task('chat'), 'Mistral', [], remote)).toContain('mistral-small-latest');
    expect(modelsFor(task('chat'), 'ChatGPT', [], remote)).toContain('gpt-4o');
    expect(modelsFor(task('transcription'), 'groq', [], remote)).toEqual(['whisper-x']);
    expect(modelsFor(task('chat'), 'llama', ['llama3.2:1b'], remote)).toEqual(['llama3.2:1b']);
  });

  it('validates the live catalog and counts distinct models', () => {
    const remote = parseRemoteCatalog({
      Claude: { text: ['a', 1], vision: ['a', 'b'], error: 5 },
      broken: 'nope',
    });
    expect(Object.keys(remote)).toEqual(['Claude']);
    expect(remote['Claude']).toEqual({
      text: ['a'],
      vision: ['a', 'b'],
      transcription: [],
      error: null,
    });
    expect(modelCount(remote['Claude']!)).toBe(2);
    expect(parseRemoteCatalog(null)).toEqual({});
  });
});

import { AI_TASKS, type AiTask, modelsFor, providersFor } from './ai-routing';

const task = (key: string): AiTask => AI_TASKS.find((item) => item.key === key)!;

describe('AI routing', () => {
  it('offers local engines for vision tasks', () => {
    expect(providersFor(task('ocr'))[0]).toEqual({ value: 'paddle', label: 'Local PaddleOCR' });
    expect(providersFor(task('chat')).map((provider) => provider.value)).toContain('Claude');
  });

  it('lists models per provider', () => {
    expect(modelsFor(task('chat'), 'llama', ['llama3.2:1b'])).toEqual(['llama3.2:1b']);
    expect(modelsFor(task('blip'), 'llama', ['llama3.2:1b', 'llava:7b'])).toEqual(['llava:7b']);
    expect(modelsFor(task('ocr'), 'paddle', [])).toEqual([]);
    expect(modelsFor(task('transcription'), 'groq', [])).toContain('whisper-large-v3-turbo');
  });
});

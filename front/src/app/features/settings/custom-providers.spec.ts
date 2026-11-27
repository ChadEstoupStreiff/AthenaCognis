import { AI_TASKS, providersFor } from './ai-routing';
import {
  draftError,
  draftOf,
  newProviderId,
  parseCustomProviders,
  upsertProvider,
} from './custom-providers';

const draft = {
  name: ' Albert ',
  base_url: 'https://albert.example/v1/',
  api_key: 'secret',
  context_tokens: '',
};

describe('Custom providers', () => {
  it('requires every field and an http URL', () => {
    expect(draftError(draft)).toBeNull();
    expect(draftError({ ...draft, api_key: ' ' })).toContain('required');
    expect(draftError({ ...draft, base_url: 'albert.example' })).toContain('http');
  });

  it('adds then replaces a provider, trimmed', () => {
    const added = upsertProvider([], 'custom:a', draft);
    expect(added).toEqual([
      { id: 'custom:a', name: 'Albert', base_url: 'https://albert.example/v1', api_key: 'secret' },
    ]);
    expect(upsertProvider(added, 'custom:a', { ...draft, name: 'B' })).toHaveLength(1);
    expect(parseCustomProviders([...added, { id: 'x' }, 'y'])).toEqual(added);
    expect(newProviderId('My API', 36)).toBe('custom:my-api-10');
  });

  it('accepts an empty or positive whole context size only', () => {
    expect(draftError({ ...draft, context_tokens: ' 32768 ' })).toBeNull();
    for (const typed of ['0', '-5', '12.5', 'big']) {
      expect(draftError({ ...draft, context_tokens: typed })).toContain('context size');
    }
  });

  it('stores the context size as a number and edits it as text', () => {
    const [saved] = upsertProvider([], 'custom:a', { ...draft, context_tokens: '32768' });
    expect(saved?.context_tokens).toBe(32768);
    expect(draftOf(saved!).context_tokens).toBe('32768');
    const [cleared] = upsertProvider([saved!], 'custom:a', { ...draft, context_tokens: '' });
    expect(cleared).not.toHaveProperty('context_tokens');
    expect(draftOf(cleared!).context_tokens).toBe('');
  });

  it('offers custom providers to text tasks only', () => {
    const custom = upsertProvider([], 'custom:a', draft);
    const values = (key: string): string[] =>
      providersFor(
        AI_TASKS.find((task) => task.key === key)!,
        custom,
      ).map((item) => item.value);
    expect(values('chat')).toContain('custom:a');
    expect(values('ocr')).not.toContain('custom:a');
    expect(values('transcription')).not.toContain('custom:a');
  });
});

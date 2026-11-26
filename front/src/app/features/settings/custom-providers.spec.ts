import { AI_TASKS, providersFor } from './ai-routing';
import {
  draftError,
  newProviderId,
  parseCustomProviders,
  upsertProvider,
} from './custom-providers';

const draft = { name: ' Albert ', base_url: 'https://albert.example/v1/', api_key: 'secret' };

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

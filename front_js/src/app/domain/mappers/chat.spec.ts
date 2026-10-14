import {
  parseChatFiles,
  parsePresets,
  serializePresets,
  stripUserDescription,
  toChatMessage,
} from './chat';

describe('chat mappers', () => {
  it('parses legacy and provenance file lists', () => {
    expect(parseChatFiles('["/a"]')).toEqual([{ path: '/a', source: 'manual' }]);
    expect(parseChatFiles('[{"path": "/b", "source": "retrieved"}]')).toEqual([
      { path: '/b', source: 'retrieved' },
    ]);
    expect(parseChatFiles(null)).toEqual([]);
    expect(parseChatFiles('not json')).toEqual([]);
  });

  it('strips the stored user description', () => {
    expect(stripUserDescription('User description: PhD\nline\n\nMessage: Hello')).toBe('Hello');
    expect(stripUserDescription('Hello')).toBe('Hello');
  });

  it('maps roles', () => {
    const base = { id: '1', session_id: 's', date: 'd', files: null, calendar: null, content: 'x' };
    expect(toChatMessage({ ...base, user: 'user' }).role).toBe('user');
    expect(toChatMessage({ ...base, user: 'llama - llama3.2:1b' })).toMatchObject({
      role: 'assistant',
      sender: 'llama - llama3.2:1b',
    });
    expect(toChatMessage({ ...base, user: 'system-error' }).role).toBe('error');
    expect(toChatMessage({ ...base, user: 'system-cancelled' }).role).toBe('cancelled');
  });

  it('round-trips presets', () => {
    const presets = parsePresets([['A', 'a'], ['bad'], 3]);
    expect(presets).toEqual([{ title: 'A', message: 'a' }]);
    expect(serializePresets(presets)).toEqual([['A', 'a']]);
  });
});

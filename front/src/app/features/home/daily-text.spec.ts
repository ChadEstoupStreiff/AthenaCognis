import { OFFLINE_SENTENCES } from './daily-text.catalog';
import {
  DEFAULT_DAILY_TEXT_KIND,
  DEFAULT_DAILY_TEXT_LANGUAGE,
  greeting,
  greetingText,
  offlineText,
  onlineText,
  parseDailyTextKind,
  parseDailyTextLanguage,
} from './daily-text';

const OFFLINE_COUNT = 10;

describe('daily text', () => {
  it('greets by time of day in each language', () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 15))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening');
    expect(greeting(new Date(2026, 0, 1, 9), 'fr')).toBe('Bonjour');
    expect(greeting(new Date(2026, 0, 1, 21), 'fr')).toBe('Bonsoir');
  });

  it('shows the greeting without a title', () => {
    expect(greetingText('fr', new Date(2026, 10, 26, 9))).toEqual({
      kind: 'greeting',
      title: '',
      text: 'Bonjour',
      author: '',
      provider: '',
      offline: false,
    });
  });

  it('titles the online text in the chosen language', () => {
    const answer = { text: 'Be.', author: 'Zen', provider: 'ZenQuotes' };
    expect(onlineText('quote', 'fr', answer)).toEqual({
      kind: 'quote',
      title: 'Citation du jour',
      text: 'Be.',
      author: 'Zen',
      provider: 'ZenQuotes',
      offline: false,
    });
    expect(onlineText('joke', 'en', { ...answer, author: '' }).title).toBe('Joke of the day');
  });

  it('keeps ten general offline sentences per language', () => {
    expect(OFFLINE_SENTENCES.fr.length).toBe(OFFLINE_COUNT);
    expect(OFFLINE_SENTENCES.en.length).toBe(OFFLINE_COUNT);
  });

  it('marks offline sentences with a neutral title, same all day', () => {
    const morning = offlineText('joke', 'en', new Date(2026, 10, 26, 0, 5));
    const night = offlineText('joke', 'en', new Date(2026, 10, 26, 23, 55));
    expect(night).toEqual(morning);
    expect(morning.offline).toBe(true);
    expect(morning.title).toBe('Thought of the day');
    expect(OFFLINE_SENTENCES.en).toContain(morning.text);
  });

  it('cycles through every offline sentence', () => {
    const seen = new Set<string>();
    for (let day = 0; day < OFFLINE_COUNT; day++) {
      seen.add(offlineText('quote', 'fr', new Date(2026, 0, 1 + day, 12)).text);
    }
    expect(seen.size).toBe(OFFLINE_COUNT);
  });

  it('falls back to defaults on unknown settings', () => {
    expect(parseDailyTextKind('poem')).toBe(DEFAULT_DAILY_TEXT_KIND);
    expect(parseDailyTextKind(3)).toBe(DEFAULT_DAILY_TEXT_KIND);
    expect(parseDailyTextKind('joke')).toBe('joke');
    expect(parseDailyTextLanguage('de')).toBe(DEFAULT_DAILY_TEXT_LANGUAGE);
    expect(parseDailyTextLanguage('fr')).toBe('fr');
  });
});

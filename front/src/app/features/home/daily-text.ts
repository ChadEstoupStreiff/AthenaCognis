import type { BackendDailyText } from '@domain/contracts';
import { OFFLINE_SENTENCES } from './daily-text.catalog';

/** Kind of text shown at the top of Home. */
export type DailyTextKind = 'greeting' | 'motivation' | 'quote' | 'joke';

/** Language of the Home text. */
export type DailyTextLanguage = 'fr' | 'en';

/** Online kinds (the greeting is computed locally). */
export type OnlineDailyTextKind = Exclude<DailyTextKind, 'greeting'>;

/** Text shown at the top of Home. */
export interface DailyText {
  readonly kind: DailyTextKind;
  readonly title: string;
  readonly text: string;
  readonly author: string;
  /** Provider name, empty for the greeting and offline sentences. */
  readonly provider: string;
  /** True when an offline sentence replaces the online text. */
  readonly offline: boolean;
}

export const DAILY_TEXT_KINDS: readonly DailyTextKind[] = [
  'greeting',
  'motivation',
  'quote',
  'joke',
];
export const DAILY_TEXT_LANGUAGES: readonly DailyTextLanguage[] = ['fr', 'en'];
export const DEFAULT_DAILY_TEXT_KIND: DailyTextKind = 'quote';
export const DEFAULT_DAILY_TEXT_LANGUAGE: DailyTextLanguage = 'en';

const MORNING_END = 12;
const AFTERNOON_END = 18;
const MS_PER_DAY = 86_400_000;
const GREETINGS: Readonly<Record<DailyTextLanguage, readonly [string, string, string]>> = {
  fr: ['Bonjour', 'Bon après-midi', 'Bonsoir'],
  en: ['Good morning', 'Good afternoon', 'Good evening'],
};
const OFFLINE_TITLES: Readonly<Record<DailyTextLanguage, string>> = {
  fr: 'Pensée du jour',
  en: 'Thought of the day',
};
const TITLES: Readonly<Record<DailyTextLanguage, Readonly<Record<DailyTextKind, string>>>> = {
  fr: {
    greeting: '',
    motivation: 'Motivation du jour',
    quote: 'Citation du jour',
    joke: 'Blague du jour',
  },
  en: {
    greeting: '',
    motivation: 'Daily motivation',
    quote: 'Quote of the day',
    joke: 'Joke of the day',
  },
};

/**
 * Narrow a setting value to a text kind.
 *
 * @param value - Stored value.
 * @returns Kind, or the default when unknown.
 */
export function parseDailyTextKind(value: unknown): DailyTextKind {
  return DAILY_TEXT_KINDS.find((kind) => kind === value) ?? DEFAULT_DAILY_TEXT_KIND;
}

/**
 * Narrow a setting value to a language.
 *
 * @param value - Stored value.
 * @returns Language, or the default when unknown.
 */
export function parseDailyTextLanguage(value: unknown): DailyTextLanguage {
  return DAILY_TEXT_LANGUAGES.find((language) => language === value) ?? DEFAULT_DAILY_TEXT_LANGUAGE;
}

/**
 * Greeting for the time of day.
 *
 * @param now - Current time.
 * @param language - Language.
 * @returns Greeting.
 */
export function greeting(now: Date, language: DailyTextLanguage = 'en'): string {
  const [morning, afternoon, evening] = GREETINGS[language];
  const hour = now.getHours();
  if (hour < MORNING_END) {
    return morning;
  }
  return hour < AFTERNOON_END ? afternoon : evening;
}

/**
 * Local day number (same all day, +1 at local midnight).
 *
 * @param now - Current time.
 * @returns Days since the epoch.
 */
function dayNumber(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

/**
 * Greeting shown when the kind is `greeting`.
 *
 * @param language - Language.
 * @param now - Current time.
 * @returns Greeting text.
 */
export function greetingText(language: DailyTextLanguage, now: Date): DailyText {
  return {
    kind: 'greeting',
    title: '',
    text: greeting(now, language),
    author: '',
    provider: '',
    offline: false,
  };
}

/**
 * Wrap a backend answer.
 *
 * @param kind - Kind of text.
 * @param language - Language.
 * @param answer - `/daily-text` answer.
 * @returns Text to show.
 */
export function onlineText(
  kind: OnlineDailyTextKind,
  language: DailyTextLanguage,
  answer: BackendDailyText,
): DailyText {
  return {
    kind,
    title: TITLES[language][kind],
    text: answer.text,
    author: answer.author,
    provider: answer.provider,
    offline: false,
  };
}

/**
 * Offline sentence of the day: same all day, changes every day.
 *
 * @param kind - Kind asked for.
 * @param language - Language.
 * @param now - Current time.
 * @returns Text to show until the providers answer again.
 */
export function offlineText(
  kind: OnlineDailyTextKind,
  language: DailyTextLanguage,
  now: Date,
): DailyText {
  const sentences = OFFLINE_SENTENCES[language];
  return {
    kind,
    title: OFFLINE_TITLES[language],
    text: sentences[dayNumber(now) % sentences.length] ?? greeting(now, language),
    author: '',
    provider: '',
    offline: true,
  };
}

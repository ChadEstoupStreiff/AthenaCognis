import type {
  BackendChatMessage,
  ChatCalendar,
  ChatFile,
  ChatMessage,
  ChatPreset,
  ChatRole,
} from '../contracts/chat';
import type { CalendarRecord } from '../contracts/time';

const DESCRIPTION_PREFIX = /^User description: [\s\S]*?\n\nMessage: /;
const SYSTEM_ROLES: Readonly<Record<string, ChatRole>> = {
  user: 'user',
  'system-error': 'error',
  'system-cancelled': 'cancelled',
};

/**
 * Parse a JSON string, returning a fallback when invalid.
 *
 * @param raw - JSON text or null.
 * @returns The parsed value, or `null`.
 */
function parseJson(raw: string | null): unknown {
  if (raw === null || raw === '') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Normalize attached files (plain paths for user messages, `{path, source}` for answers).
 *
 * @param raw - Stored JSON.
 * @returns Files.
 */
export function parseChatFiles(raw: string | null): ChatFile[] {
  const value = parseJson(raw);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item: unknown): ChatFile[] => {
    if (typeof item === 'string') {
      return [{ path: item, source: 'manual' }];
    }
    const record = (typeof item === 'object' && item !== null ? item : {}) as Record<
      string,
      unknown
    >;
    const path = record['path'];
    return typeof path === 'string'
      ? [{ path, source: record['source'] === 'retrieved' ? 'retrieved' : 'manual' }]
      : [];
  });
}

/**
 * Remove the "User description: … Message: " prefix the backend stores in user messages.
 *
 * @param content - Stored content.
 * @returns What the user typed.
 */
export function stripUserDescription(content: string): string {
  return content.replace(DESCRIPTION_PREFIX, '');
}

/**
 * Normalize a stored message.
 *
 * @param message - Raw message.
 * @returns SPA message.
 */
export function toChatMessage(message: BackendChatMessage): ChatMessage {
  const role = SYSTEM_ROLES[message.user] ?? 'assistant';
  const calendars = parseJson(message.calendar);
  return {
    id: message.id,
    date: message.date,
    role,
    sender: role === 'assistant' ? message.user : '',
    content: role === 'user' ? stripUserDescription(message.content) : message.content,
    files: parseChatFiles(message.files),
    calendars: Array.isArray(calendars) ? (calendars as ChatCalendar[]) : [],
  };
}

/**
 * Calendar record in the shape the chat backend expects.
 *
 * @param record - SPA record.
 * @returns Chat calendar.
 */
export function toChatCalendar(record: CalendarRecord): ChatCalendar {
  return {
    title: record.title,
    project: record.project,
    date: record.date,
    time_spent: record.hours,
    description: record.description,
    location: record.location,
    attendees: record.attendees,
  };
}

/**
 * Parse the `chat_presets` setting (`[[title, message], …]`).
 *
 * @param value - Setting value.
 * @returns Presets.
 */
export function parsePresets(value: unknown): ChatPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown): ChatPreset[] => {
    if (!Array.isArray(entry)) {
      return [];
    }
    const [title, message] = entry as unknown[];
    return typeof title === 'string' && typeof message === 'string' ? [{ title, message }] : [];
  });
}

/**
 * Serialize presets for the `chat_presets` setting.
 *
 * @param presets - Presets.
 * @returns Stored value.
 */
export function serializePresets(presets: readonly ChatPreset[]): string[][] {
  return presets.map((preset) => [preset.title, preset.message]);
}

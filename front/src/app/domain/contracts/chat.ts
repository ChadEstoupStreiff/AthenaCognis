/** Chat session (`GET /chat/list`). */
export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly date: string;
}

/** Raw chat message (`files`/`calendar` are JSON strings). */
export interface BackendChatMessage {
  readonly id: string;
  readonly session_id: string;
  readonly date: string;
  readonly user: string;
  readonly files: string | null;
  readonly calendar: string | null;
  readonly content: string;
}

/** Calendar record as the chat backend expects it (`ChatMessageRequest.calendars`). */
export interface ChatCalendar {
  readonly title: string;
  readonly project: string;
  readonly date: string;
  readonly time_spent: number;
  readonly description: string | null;
  readonly location: string | null;
  readonly attendees: string | null;
}

/** File attached to a message (`retrieved` = found by RAG). */
export interface ChatFile {
  readonly path: string;
  readonly source: 'manual' | 'retrieved';
}

/** Who wrote a message. */
export type ChatRole = 'user' | 'assistant' | 'error' | 'cancelled';

/** Chat message as used by the SPA. */
export interface ChatMessage {
  readonly id: string;
  readonly date: string;
  readonly role: ChatRole;
  /** Model label for assistant messages (`<ai_type> - <model>`). */
  readonly sender: string;
  readonly content: string;
  readonly files: readonly ChatFile[];
  readonly calendars: readonly ChatCalendar[];
}

/** Body of `POST /chat/{id}/message`. */
export interface ChatMessageRequest {
  readonly user_description?: string;
  readonly content: string;
  readonly files: readonly string[];
  readonly calendars: readonly ChatCalendar[];
  readonly rag_enabled: boolean;
}

/** Generation state (`GET /chat/{id}/is_running`). */
export interface ChatRunState {
  readonly state: 'running' | 'not_running';
  readonly answer?: string;
}

/** Message preset (stored as `[title, message]` in the `chat_presets` setting). */
export interface ChatPreset {
  readonly title: string;
  readonly message: string;
}

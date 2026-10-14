/** Error shown to the user, normalized from FastAPI's three error formats. */
export interface ApiProblem {
  readonly status: number;
  readonly message: string;
  readonly detail?: unknown;
}

const MAX_MESSAGE_LENGTH = 500;
const INTERNAL_ERROR = 500;
const NOT_FOUND = 404;
const WRAPPED_NOT_FOUND = /\b404\b|not found/i;

/**
 * Normalize a FastAPI error body (`{detail: string}`, 422 `{detail: [...]}` or plain text).
 *
 * FastAPI handlers often re-raise their own 404 as a 500; those are reported as 404.
 *
 * @param status - HTTP status.
 * @param body - Parsed JSON body or text.
 * @returns The problem.
 */
export function problemFromBackend(status: number, body: unknown): ApiProblem {
  const detail =
    typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
  let message: string;
  if (typeof detail === 'string') {
    message = detail;
  } else if (Array.isArray(detail)) {
    return { status, message: 'The backend rejected the request parameters.', detail };
  } else {
    message = typeof body === 'string' && body.trim() !== '' ? body.trim() : 'Backend error.';
  }
  message = message.slice(0, MAX_MESSAGE_LENGTH);
  const wrappedNotFound = status === INTERNAL_ERROR && WRAPPED_NOT_FOUND.test(message);
  return { status: wrappedNotFound ? NOT_FOUND : status, message };
}

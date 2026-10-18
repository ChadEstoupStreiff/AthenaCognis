import { HttpContextToken, HttpErrorResponse } from '@angular/common/http';
import { type ApiProblem, problemFromBackend } from '@domain/contracts';

/** Request context flag: do not toast errors for this request (the caller handles them). */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);

const NETWORK_ERROR_STATUS = 0;

/**
 * Convert any HTTP failure into an {@link ApiProblem}.
 *
 * @param error - Thrown value (usually an `HttpErrorResponse`).
 * @returns The problem.
 */
export function toApiProblem(error: unknown): ApiProblem {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      status: NETWORK_ERROR_STATUS,
      message: error instanceof Error ? error.message : 'Unexpected error.',
    };
  }
  if (error.status === NETWORK_ERROR_STATUS) {
    return { status: NETWORK_ERROR_STATUS, message: 'The backend is unreachable.' };
  }
  return problemFromBackend(error.status, error.error);
}

/**
 * Check whether an error is an API problem with a given status.
 *
 * @param error - Thrown value.
 * @param status - Expected status code.
 * @returns `true` when the failure has that status.
 */
export function hasStatus(error: unknown, status: number): boolean {
  return toApiProblem(error).status === status;
}

import { type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SILENT_ERRORS, toApiProblem } from '../api/api-error';
import { NotifyService } from '../notify/notify.service';

/**
 * Turn failures into toasts (unless the request is marked silent).
 *
 * @param request - Outgoing request.
 * @param next - Next handler.
 * @returns The response stream (errors are re-thrown).
 */
export const problemInterceptor: HttpInterceptorFn = (request, next) => {
  const notify = inject(NotifyService);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!request.context.get(SILENT_ERRORS)) {
        notify.error(toApiProblem(error).message);
      }
      return throwError(() => error);
    }),
  );
};

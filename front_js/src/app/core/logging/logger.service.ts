/* eslint-disable no-console -- the logger is the single console sink of the SPA */
import { Injectable, isDevMode } from '@angular/core';

/** Minimal leveled logger (debug output only in dev mode). */
@Injectable({ providedIn: 'root' })
export class Logger {
  /**
   * Log debug details (dev mode only).
   *
   * @param message - Message.
   * @param context - Extra values.
   */
  debug(message: string, ...context: unknown[]): void {
    if (isDevMode()) {
      console.debug(`[athena] ${message}`, ...context);
    }
  }

  /**
   * Log a warning.
   *
   * @param message - Message.
   * @param context - Extra values.
   */
  warn(message: string, ...context: unknown[]): void {
    console.warn(`[athena] ${message}`, ...context);
  }

  /**
   * Log an error.
   *
   * @param message - Message.
   * @param context - Extra values.
   */
  error(message: string, ...context: unknown[]): void {
    console.error(`[athena] ${message}`, ...context);
  }
}

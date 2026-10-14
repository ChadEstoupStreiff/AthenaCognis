import { inject, Injectable } from '@angular/core';
import { MessageService } from 'primeng/api';

const ERROR_LIFE_MS = 6_000;
const DEFAULT_LIFE_MS = 3_000;

/** Toast notifications (wraps PrimeNG's message service). */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly messages = inject(MessageService);

  /**
   * Show a success toast.
   *
   * @param summary - Title.
   * @param detail - Optional detail line.
   */
  success(summary: string, detail?: string): void {
    this.messages.add({ severity: 'success', summary, detail, life: DEFAULT_LIFE_MS });
  }

  /**
   * Show an info toast.
   *
   * @param summary - Title.
   * @param detail - Optional detail line.
   */
  info(summary: string, detail?: string): void {
    this.messages.add({ severity: 'info', summary, detail, life: DEFAULT_LIFE_MS });
  }

  /**
   * Show a warning toast.
   *
   * @param summary - Title.
   * @param detail - Optional detail line.
   */
  warn(summary: string, detail?: string): void {
    this.messages.add({ severity: 'warn', summary, detail, life: ERROR_LIFE_MS });
  }

  /**
   * Show an error toast.
   *
   * @param summary - Title.
   * @param detail - Optional detail line.
   */
  error(summary: string, detail?: string): void {
    this.messages.add({ severity: 'error', summary, detail, life: ERROR_LIFE_MS });
  }
}

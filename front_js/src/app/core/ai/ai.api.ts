import { inject, Injectable } from '@angular/core';
import { ApiClient, backendUrl } from '../api/api-client';

/** AI text helpers. */
@Injectable({ providedIn: 'root' })
export class AiApi {
  private readonly api = inject(ApiClient);

  /**
   * Rewrite a text following an instruction (the backend's "refractor" model).
   *
   * @param text - Source text.
   * @param instruction - What to do.
   * @returns The suggestion.
   */
  rewrite(text: string, instruction: string): Promise<string> {
    return this.api.get<string>(backendUrl('/utils/ai/refractor'), {
      params: { text, question: instruction },
    });
  }
}

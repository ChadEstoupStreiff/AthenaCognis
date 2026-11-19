import { inject, Injectable } from '@angular/core';
import type { DailyGeneration, DailyGenerationRequest } from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';

/** Activity generation: queue a period and read what was generated. */
@Injectable({ providedIn: 'root' })
export class ActivityGenerationApi {
  private readonly api = inject(ApiClient);

  /**
   * What was generated for a day.
   *
   * @param day - Local day, `YYYY-MM-DD`.
   * @returns Latest run, note and time entries.
   */
  daily(day: string): Promise<DailyGeneration> {
    return this.api.get<DailyGeneration>(
      backendUrl(`/activity-generation/daily/${encodeURIComponent(day)}`),
    );
  }

  /**
   * Queue the generation of a day.
   *
   * @param request - Day, sources and outputs.
   * @returns Queued job key.
   */
  generateDaily(request: DailyGenerationRequest): Promise<{ key: string }> {
    return this.api.post<{ key: string }>(backendUrl('/activity-generation/daily'), request);
  }
}

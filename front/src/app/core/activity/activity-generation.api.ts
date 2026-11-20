import { inject, Injectable } from '@angular/core';
import type { DailyGeneration, DailyGenerationRequest, GenerationDryRun } from '@domain/contracts';
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

  /**
   * Build the prompts of a day without asking the LLM.
   *
   * @param request - Day, sources and outputs.
   * @returns Prompts with their size, activities per source, routed model.
   */
  dryRunDaily(request: DailyGenerationRequest): Promise<GenerationDryRun> {
    return this.api.post<GenerationDryRun>(
      backendUrl('/activity-generation/daily/dry-run'),
      request,
    );
  }
}

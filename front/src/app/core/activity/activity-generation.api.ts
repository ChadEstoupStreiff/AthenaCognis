import { inject, Injectable } from '@angular/core';
import type {
  DailyGeneration,
  DailyGenerationRequest,
  DayStatus,
  GenerationDryRun,
  HolidayCountries,
} from '@domain/contracts';
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

  /**
   * Status of each day of a span, for the calendar.
   *
   * @param first - First local day, `YYYY-MM-DD`.
   * @param last - Last local day, `YYYY-MM-DD`.
   * @returns One status per day.
   */
  dailyStatus(first: string, last: string): Promise<readonly DayStatus[]> {
    const query = new URLSearchParams({ first, last });
    return this.api.get<readonly DayStatus[]>(
      backendUrl(`/activity-generation/daily-status?${query.toString()}`),
    );
  }

  /**
   * Countries with known public holidays.
   *
   * @returns Subdivision codes per country code.
   */
  holidayCountries(): Promise<HolidayCountries> {
    return this.api.get<HolidayCountries>(backendUrl('/activity-generation/holiday-countries'));
  }
}

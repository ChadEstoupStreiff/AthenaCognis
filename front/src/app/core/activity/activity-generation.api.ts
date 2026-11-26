import { inject, Injectable } from '@angular/core';
import type {
  DayStatus,
  GenerationDryRun,
  GenerationRequest,
  GenerationSpan,
  HolidayCountries,
  PeriodGeneration,
} from '@domain/contracts';
import { ApiClient, backendUrl } from '../api/api-client';

/** Activity generation: queue a period and read what was generated. */
@Injectable({ providedIn: 'root' })
export class ActivityGenerationApi {
  private readonly api = inject(ApiClient);

  /**
   * What was generated for a period.
   *
   * @param span - Time span.
   * @param day - First local day, `YYYY-MM-DD`.
   * @returns Latest run and note.
   */
  generation(span: GenerationSpan, day: string): Promise<PeriodGeneration> {
    return this.api.get<PeriodGeneration>(
      backendUrl(`/activity-generation/${span}/${encodeURIComponent(day)}`),
    );
  }

  /**
   * Queue the generation of a period.
   *
   * @param request - Period, context and custom instruction.
   * @returns Queued job key.
   */
  generate(request: GenerationRequest): Promise<{ key: string }> {
    return this.api.post<{ key: string }>(backendUrl('/activity-generation/generate'), request);
  }

  /**
   * Build the prompt of a period without asking the LLM.
   *
   * @param request - Period, context and custom instruction.
   * @returns Prompt with its size, activities per source, routed model.
   */
  dryRun(request: GenerationRequest): Promise<GenerationDryRun> {
    return this.api.post<GenerationDryRun>(backendUrl('/activity-generation/dry-run'), request);
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

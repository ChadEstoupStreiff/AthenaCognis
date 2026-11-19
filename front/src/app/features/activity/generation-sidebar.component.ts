import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  GENERATION_SPANS,
  type DataSourceInfo,
  type GenerationOutput,
  type GenerationSpan,
  type SettingValue,
} from '@domain/contracts';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  DAY_START_SETTING,
  TIMEZONE_SETTING,
  WEEK_START_SETTING,
  spanSetting,
} from '../../core/activity/generation-settings';
import { SettingsSection } from '../settings/sections/settings-section';
import { SettingsWriter } from '../settings/settings-writer';

const SPAN_LABELS: Readonly<Record<GenerationSpan, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
/** Summaries a longer span is built from. */
const BUILT_FROM: Readonly<Record<GenerationSpan, string | null>> = {
  daily: null,
  weekly: 'Use generated daily',
  monthly: 'Use generated weekly',
};
/** Spans the backend generates (and schedules) today. */
const AVAILABLE_SPANS: ReadonlySet<GenerationSpan> = new Set(['daily']);
const DEFAULT_DAY_START = '00:00';
const BOTH_OUTPUTS: readonly GenerationOutput[] = ['summary', 'time'];
const OUTPUT_OPTIONS: readonly { value: GenerationOutput; label: string }[] = [
  { value: 'summary', label: 'Summary as a note' },
  { value: 'time', label: 'Fill time entries' },
];
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];
/** PrimeNG first day of week: 0 = Sunday. */
const DAYS_PER_WEEK = 7;

/** Sidebar of Activity generation: timeline, calendar and the timeline's schedule. */
@Component({
  selector: 'ac-generation-sidebar',
  imports: [
    FormsModule,
    CheckboxModule,
    DatePickerModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    SelectButtonModule,
    ToggleSwitchModule,
  ],
  providers: [SettingsWriter],
  templateUrl: './generation-sidebar.component.html',
  styleUrl: '../settings/sections/section.scss',
  styles: `
    :host {
      display: block;
    }
    .group {
      grid-template-columns: minmax(0, 1fr);
      margin-bottom: 0;
    }
    h2,
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h3 {
      margin: 8px 0 0;
      font-size: 14px;
    }
    .pi-bolt {
      color: var(--p-primary-color);
    }
    .calendar {
      display: flex;
      justify-content: center;
    }
    .output {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .outputs {
      display: grid;
      gap: 6px;
    }
    p-multiselect,
    p-select {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationSidebarComponent extends SettingsSection {
  /** Selected timeline (two-way). */
  readonly span = model.required<GenerationSpan>();
  /** Picked day (two-way); any day of the week or month for longer spans. */
  readonly picked = model.required<Date>();
  /** Enabled data sources. */
  readonly sources = input.required<readonly DataSourceInfo[]>();

  protected readonly spanOptions = GENERATION_SPANS.map((value) => ({
    value,
    label: SPAN_LABELS[value],
  }));
  protected readonly outputOptions = OUTPUT_OPTIONS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly dayStartKey = DAY_START_SETTING;
  protected readonly weekStartKey = WEEK_START_SETTING;
  protected readonly today = new Date();
  protected readonly spanLabel = computed(() => SPAN_LABELS[this.span()]);
  protected readonly builtFrom = computed(() => BUILT_FROM[this.span()]);
  protected readonly isAvailable = computed(() => AVAILABLE_SPANS.has(this.span()));
  protected readonly sourceOptions = computed(() => [...this.sources()]);
  /** PrimeNG first day of week (0 = Sunday) from the week start setting. */
  protected readonly firstDayOfWeek = computed(() => this.weekStart() % DAYS_PER_WEEK);

  /**
   * Setting key of a field of the selected timeline's schedule.
   *
   * @param name - Field name.
   * @returns Setting key.
   */
  protected key(name: string): string {
    return spanSetting(this.span(), name);
  }

  /**
   * Local time days start at.
   *
   * @returns `HH:MM`.
   */
  protected dayStart(): string {
    return this.text(DAY_START_SETTING, DEFAULT_DAY_START);
  }

  /**
   * ISO weekday weeks start on.
   *
   * @returns 1 (Monday) … 7 (Sunday).
   */
  protected weekStart(): number {
    return this.num(WEEK_START_SETTING, 1);
  }

  /**
   * Context of the selected weekly or monthly schedule.
   *
   * @returns `generated` or `sources`.
   */
  protected basis(): string {
    return this.text(this.key('basis'), 'generated');
  }

  /**
   * Whether the selected schedule reads data sources.
   *
   * @returns True for daily, or longer spans set to data sources.
   */
  protected usesSources(): boolean {
    return this.builtFrom() === null || this.basis() === 'sources';
  }

  /**
   * Outputs of the selected schedule.
   *
   * @returns Picked outputs (both by default).
   */
  protected outputs(): readonly string[] {
    return this.stableList(this.key('outputs'), BOTH_OUTPUTS);
  }

  /**
   * Data sources of the selected schedule.
   *
   * @returns Keys; empty = every enabled source.
   */
  protected pickedSources(): readonly string[] {
    return this.stableList(this.key('sources'), []);
  }

  /**
   * Last day generated by the daily schedule.
   *
   * @returns Day key, "" when never.
   */
  protected lastRun(): string {
    return this.text(spanSetting('daily', 'last'));
  }

  /**
   * Add or remove an output of the selected schedule.
   *
   * @param value - Output.
   * @param checked - Wanted.
   */
  protected toggleOutput(value: GenerationOutput, checked: boolean): void {
    const current = this.outputs().filter((item) => item !== value);
    this.saveSchedule(this.key('outputs'), checked ? [...current, value] : current);
  }

  /**
   * Pick a day of the calendar.
   *
   * @param date - Picked date.
   */
  protected pick(date: Date | null): void {
    if (date !== null) {
      this.picked.set(date);
    }
  }

  /**
   * Save a schedule setting with the browser time zone (the scheduler runs in it).
   *
   * @param key - Setting key.
   * @param value - Value.
   * @param immediate - Skip the debounce.
   */
  protected saveSchedule(key: string, value: SettingValue, immediate = false): void {
    this.save(key, value, immediate);
    this.save(TIMEZONE_SETTING, Intl.DateTimeFormat().resolvedOptions().timeZone);
  }
}

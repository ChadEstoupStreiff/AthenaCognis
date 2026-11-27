import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  resource,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  GENERATION_SPANS,
  type DataSourceInfo,
  type DayState,
  type GenerationOutput,
  type GenerationSpan,
  type SettingValue,
} from '@domain/contracts';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule, type DatePickerMonthChangeEvent } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ActivityGenerationApi } from '../../core/activity/activity-generation.api';
import {
  HOLIDAYS_COUNTRY_SETTING,
  HOLIDAYS_SUBDIVISION_SETTING,
  OFF_DAYS_SETTING,
  cellKey,
  monthOf,
  statusIndex,
  statusTitle,
  visibleSpan,
  type CalendarCell,
} from '../../core/activity/day-status';
import {
  BOTH_OUTPUTS,
  DAILY_WEEKDAY_OPTIONS,
  DAY_START_SETTING,
  TIMEZONE_SETTING,
  FILL_WITH_DAILY_LABEL,
  MAX_INSTRUCTION_LENGTH,
  OUTPUT_OPTIONS,
  WEEK_START_SETTING,
  contextOptions,
  offersFillWithDaily,
  spanSetting,
  storedBasis,
  type GenerationBasis,
} from '../../core/activity/generation-settings';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { SettingsSection } from '../settings/sections/settings-section';
import { SettingsWriter } from '../settings/settings-writer';
import { OffDaysSettingsComponent } from './off-days-settings.component';

const SPAN_LABELS: Readonly<Record<GenerationSpan, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
const DEFAULT_DAY_START = '00:00';
/** What each schedule does, under its toggle. */
const SCHEDULE_HINTS: Readonly<Record<GenerationSpan, string>> = {
  daily: 'Generates the day that just ended, when the next one starts.',
  weekly: 'Generates the week that just ended, when the next one starts.',
  monthly: 'Generates the month that just ended, on the 1st at the day start.',
};
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];
/** Saved settings deciding non working days (calendar greyed days). */
const OFF_RULE_SETTINGS: readonly string[] = [
  spanSetting('daily', 'weekdays'),
  HOLIDAYS_COUNTRY_SETTING,
  HOLIDAYS_SUBDIVISION_SETTING,
  OFF_DAYS_SETTING,
];
/** Calendar dot legend. */
const LEGEND: readonly { state: DayState; label: string }[] = [
  { state: 'generated', label: 'Generated' },
  { state: 'failed', label: 'Failed' },
  { state: 'skipped', label: 'Skipped' },
];
/** PrimeNG first day of week: 0 = Sunday. */
const DAYS_PER_WEEK = 7;

/** Sidebar of Activity generation: timeline, calendar and the timeline's schedule. */
@Component({
  selector: 'ac-generation-sidebar',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    CheckboxModule,
    DatePickerModule,
    InputTextModule,
    MultiSelectModule,
    OffDaysSettingsComponent,
    SelectModule,
    SelectButtonModule,
    TextareaModule,
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
      font-size: calc(14px * var(--ac-font-scale));
    }
    .pi-bolt {
      color: var(--p-primary-color);
    }
    .calendar {
      display: flex;
      justify-content: center;
    }
    .cell {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    .cell.off {
      color: var(--p-text-muted-color);
      opacity: 0.6;
    }
    .dot {
      position: absolute;
      bottom: 1px;
      left: 50%;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      transform: translateX(-50%);
    }
    .legend {
      display: flex;
      justify-content: center;
      gap: 12px;
      font-size: calc(12px * var(--ac-font-scale));
    }
    .legend > span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .legend .dot {
      position: static;
      transform: none;
    }
    .dot.generated {
      background: #f5b700;
    }
    .dot.running {
      border: 1px solid #f5b700;
    }
    .dot.failed {
      background: var(--p-red-500);
    }
    .dot.skipped {
      background: var(--p-gray-400);
    }
    p-multiselect,
    p-select,
    textarea {
      width: 100%;
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationSidebarComponent extends SettingsSection {
  private readonly api = inject(ActivityGenerationApi);
  private readonly sync = inject(DataSync);
  private readonly settings = inject(SettingsStore);

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
  protected readonly maxInstructionLength = MAX_INSTRUCTION_LENGTH;
  protected readonly outputOptions = OUTPUT_OPTIONS;
  protected readonly fillWithDailyLabel = FILL_WITH_DAILY_LABEL;
  protected readonly weekdays = WEEKDAYS;
  protected readonly legend = LEGEND;
  /** Daily weekday choices as a mutable array (PrimeNG options). */
  protected readonly dailyWeekdayOptions = [...DAILY_WEEKDAY_OPTIONS];
  protected readonly dayStartKey = DAY_START_SETTING;
  protected readonly weekStartKey = WEEK_START_SETTING;
  protected readonly today = new Date();
  protected readonly spanLabel = computed(() => SPAN_LABELS[this.span()]);
  protected readonly scheduleHint = computed(() => SCHEDULE_HINTS[this.span()]);
  /** Context choices as a mutable array (PrimeNG options). */
  protected readonly contextChoices = computed(() => [...contextOptions(this.span())]);
  protected readonly hasContextChoice = computed(() => this.contextChoices().length > 0);
  protected readonly sourceOptions = computed(() => [...this.sources()]);
  /** Month shown by the calendar: the picked one until the user browses. */
  protected readonly viewMonth = linkedSignal(() => monthOf(this.picked()));
  /** Status of the shown days; refetched after generations and settings changes. */
  private readonly statuses = resource({
    params: () => ({
      span: visibleSpan(this.viewMonth()),
      generation: this.sync.version('generation')(),
      offRules: JSON.stringify(OFF_RULE_SETTINGS.map((key) => this.settings.values()[key])),
    }),
    loader: ({ params }) => this.api.dailyStatus(params.span.first, params.span.last),
  });
  private readonly statusByDay = computed(() =>
    statusIndex(this.statuses.hasValue() ? this.statuses.value() : []),
  );
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
   * @returns Stored context, `generated` when unset or not offered.
   */
  protected basis(): GenerationBasis {
    return storedBasis(this.writer.value(this.key('basis')), this.span());
  }

  /**
   * Whether the selected schedule offers the fill-with-daily toggle.
   *
   * @returns True for monthly built from weekly summaries.
   */
  protected showsFillWithDaily(): boolean {
    return offersFillWithDaily(this.span(), this.basis());
  }

  /**
   * Whether the selected schedule reads data sources.
   *
   * @returns True for daily, or longer spans set to data sources.
   */
  protected usesSources(): boolean {
    return !this.hasContextChoice() || this.basis() === 'sources';
  }

  /**
   * Custom instruction of the selected schedule.
   *
   * @returns Text, "" when none.
   */
  protected instruction(): string {
    return this.text(this.key('instruction'));
  }

  /**
   * Outputs of the daily schedule (weekly and monthly make the summary only).
   *
   * @returns Picked outputs (both by default).
   */
  protected dailyOutputs(): readonly string[] {
    return this.stableList(spanSetting('daily', 'outputs'), BOTH_OUTPUTS);
  }

  /**
   * Add or remove an output of the daily schedule.
   *
   * @param value - Output.
   * @param checked - Wanted.
   */
  protected toggleOutput(value: GenerationOutput, checked: boolean): void {
    const current = this.dailyOutputs().filter((item) => item !== value);
    this.saveSchedule(spanSetting('daily', 'outputs'), checked ? [...current, value] : current);
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
   * Weekdays the daily schedule generates.
   *
   * @returns Weekday codes; empty = every day.
   */
  protected dailyWeekdays(): readonly string[] {
    return this.stableList(spanSetting('daily', 'weekdays'), []);
  }

  /**
   * First day of the last period queued by the selected schedule.
   *
   * @returns Day key, "" when never.
   */
  protected lastRun(): string {
    return this.text(this.key('last'));
  }

  /**
   * Dot class of a calendar day.
   *
   * @param cell - Calendar cell.
   * @returns State of the day, "" when none.
   */
  protected dotOf(cell: CalendarCell): string {
    return this.statusByDay().get(cellKey(cell))?.state ?? '';
  }

  /**
   * Whether the settings make a calendar day non working.
   *
   * @param cell - Calendar cell.
   * @returns True for weekdays not picked, holidays and off days.
   */
  protected isOff(cell: CalendarCell): boolean {
    return (this.statusByDay().get(cellKey(cell))?.off ?? null) !== null;
  }

  /**
   * Tooltip of a calendar day.
   *
   * @param cell - Calendar cell.
   * @returns State, reason and non working reason.
   */
  protected titleOf(cell: CalendarCell): string {
    return statusTitle(this.statusByDay().get(cellKey(cell)));
  }

  /**
   * Follow the month browsed in the calendar.
   *
   * @param event - New month (1-based) and year.
   */
  protected browse(event: DatePickerMonthChangeEvent): void {
    if (event.month !== undefined && event.year !== undefined) {
      this.viewMonth.set({ year: event.year, month: event.month });
    }
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

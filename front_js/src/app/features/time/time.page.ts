import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { TabsModule } from 'primeng/tabs';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import type { CalendarRecord } from '@domain/contracts';
import { formatLocalDate } from '@domain/time';
import { FilesApi } from '../../core/files/files.api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { CalendarApi } from '../../core/time/calendar.api';
import { FileCollectionComponent } from '../../shared/files/file-collection.component';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import { RecordDialogComponent } from './record-dialog.component';
import { StatsPanelComponent } from './stats-panel.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import {
  type CalendarDay,
  dayStatus,
  type DayStatus,
  goalProgress,
  groupBy,
  monthKey,
  monthWeeks,
  parseMonthKey,
  totalHours,
} from './time-model';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WORK_DAYS = 5;
const PERCENT = 100;
const MAX_BAR_PERCENT = 100;
const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const DECIMALS = 1;

/** Data of one grid cell. */
interface DayCell extends CalendarDay {
  readonly hours: number;
  readonly records: number;
  readonly files: number;
  readonly status: DayStatus;
  readonly bar: number;
}

/** Time: month calendar of logged hours, day details, statistics. */
@Component({
  selector: 'ac-time-page',
  imports: [
    FormsModule,
    ButtonModule,
    DrawerModule,
    TabsModule,
    ToggleSwitchModule,
    FileCollectionComponent,
    TagChipComponent,
    RecordDialogComponent,
    StatsPanelComponent,
    MarkdownViewComponent,
  ],
  templateUrl: './time.page.html',
  styleUrl: './time.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimePage {
  private readonly calendar = inject(CalendarApi);
  private readonly files = inject(FilesApi);
  private readonly settings = inject(SettingsStore);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);

  /** Query parameter `YYYY-MM`. */
  readonly month = input<string | undefined>(undefined);
  /** Query parameter: `stats` shows statistics. */
  readonly tab = input<string | undefined>(undefined);
  /** Query parameter: `1` opens the "Log time" dialog. */
  readonly log = input<string | undefined>(undefined);

  protected readonly today = formatLocalDate(new Date());
  protected readonly weekends = signal(false);
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<CalendarRecord | null>(null);

  private readonly current = computed(
    () =>
      parseMonthKey(this.month()) ?? {
        year: new Date().getFullYear(),
        month: new Date().getMonth(),
      },
  );
  protected readonly monthLabel = computed(() =>
    MONTH_FORMAT.format(new Date(this.current().year, this.current().month, 1)),
  );
  protected readonly weeks = computed(() =>
    monthWeeks(this.current().year, this.current().month, this.weekends()),
  );
  protected readonly weekdays = computed(() =>
    this.weekends() ? WEEKDAYS : WEEKDAYS.slice(0, WORK_DAYS),
  );
  private readonly range = computed(() => {
    const days = this.weeks().flat();
    return { start: days[0]?.date ?? this.today, end: days.at(-1)?.date ?? this.today };
  });

  protected readonly records = resource({
    params: () => ({ ...this.range(), version: this.sync.version('calendar')() }),
    loader: ({ params, abortSignal }) =>
      this.calendar.search({ start: params.start, end: params.end }, abortSignal),
  });
  protected readonly monthFiles = resource({
    params: () => ({ ...this.range(), version: this.sync.version('files')() }),
    loader: ({ params, abortSignal }) =>
      this.files.filesBetween(params.start, params.end, abortSignal),
  });

  private readonly recordsByDay = computed(() =>
    groupBy(this.records.value() ?? [], (record) => record.date),
  );
  private readonly filesByDay = computed(() =>
    groupBy(this.monthFiles.value() ?? [], (path) => path.split('/')[2] ?? ''),
  );
  protected readonly target = computed(() => this.settings.get('target_hourly_working_time'));

  protected readonly grid = computed<DayCell[][]>(() =>
    this.weeks().map((week) =>
      week.map((day) => {
        const records = this.recordsByDay().get(day.date) ?? [];
        const hours = totalHours(records);
        return {
          ...day,
          hours,
          records: records.length,
          files: this.filesByDay().get(day.date)?.length ?? 0,
          status: dayStatus(day.date, hours, this.target(), this.today),
          bar: Math.min(MAX_BAR_PERCENT, (hours / Math.max(this.target(), 1)) * PERCENT),
        };
      }),
    ),
  );

  protected readonly weekTotals = computed(() =>
    this.grid().map((week) =>
      totalHours(week.flatMap((day) => this.recordsByDay().get(day.date) ?? [])),
    ),
  );
  protected readonly monthTotal = computed(() =>
    totalHours(
      (this.records.value() ?? []).filter((record) =>
        record.date.startsWith(monthKey(this.current().year, this.current().month)),
      ),
    ).toFixed(DECIMALS),
  );
  protected readonly dayRecords = computed(
    () => this.recordsByDay().get(this.selectedDay() ?? '') ?? [],
  );
  protected readonly dayTotal = computed(() => totalHours(this.dayRecords()));
  protected readonly dayFiles = computed(
    () => this.filesByDay().get(this.selectedDay() ?? '') ?? [],
  );
  protected readonly dayLabel = computed(() => {
    const day = this.selectedDay();
    return day === null ? '' : DAY_FORMAT.format(new Date(`${day}T12:00:00`));
  });

  protected readonly goal = computed(() => {
    if (this.settings.values()['calendar_progress_bar_enabled'] !== true) {
      return null;
    }
    const setting = (key: string, fallback: string): string => {
      const value = this.settings.values()[`calendar_progress_bar_${key}`];
      return typeof value === 'string' && value !== '' ? value : fallback;
    };
    const progress = goalProgress(setting('start_date', ''), setting('end_date', ''), new Date());
    const gradient = `linear-gradient(90deg, ${setting('color1', '#7700a7')}, ${setting('color2', '#2563eb')})`;
    return progress === null
      ? null
      : { ...progress, title: setting('title', 'Progress'), gradient };
  });

  /** Open the dialog requested by the URL (`?log=1`). */
  constructor() {
    effect(() => {
      if (this.log() === '1') {
        untracked(() => {
          this.logTime(this.today);
          void this.router.navigate([], {
            queryParams: { log: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        });
      }
    });
  }

  /**
   * Show another month.
   *
   * @param delta - Months to move (0 = today).
   */
  protected shiftMonth(delta: number): void {
    const { year, month } = this.current();
    const target = delta === 0 ? new Date() : new Date(year, month + delta, 1);
    void this.router.navigate([], {
      queryParams: { month: monthKey(target.getFullYear(), target.getMonth()) },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Switch tab.
   *
   * @param tab - Tab value.
   */
  protected selectTab(tab: string | number | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: tab === 'stats' ? 'stats' : null },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Open the create dialog (optionally for a day).
   *
   * @param day - Preselected day.
   */
  protected logTime(day: string | null = null): void {
    this.editing.set(null);
    this.selectedDay.set(day ?? this.selectedDay());
    this.dialogOpen.set(true);
  }

  /**
   * Open the edit dialog.
   *
   * @param record - Record.
   */
  protected edit(record: CalendarRecord): void {
    this.editing.set(record);
    this.dialogOpen.set(true);
  }

  /**
   * Hours label.
   *
   * @param hours - Hours.
   * @returns Label.
   */
  protected hoursLabel(hours: number): string {
    return `${hours.toFixed(DECIMALS)}h`;
  }
}

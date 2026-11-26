import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MeterGroupModule } from 'primeng/metergroup';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { formatLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { DashboardApi } from '../../core/dashboard/dashboard.api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { FileCollectionComponent } from '../../shared/files/file-collection.component';
import { formatBytes } from '../../shared/pipes/bytes.pipe';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import {
  diskSegments,
  dueTasks,
  kpiGroups,
  mailCategorySegments,
  topSegments,
  typeColor,
  type MeterSegment,
} from './home-model';
import {
  type DailyText,
  type DailyTextKind,
  type DailyTextLanguage,
  greetingText,
  offlineText,
  onlineText,
  parseDailyTextKind,
  parseDailyTextLanguage,
} from './daily-text';

const WORK_DAYS = 5;
/** Retry the online text this often while offline sentences are shown. */
const OFFLINE_RETRY_MS = 300_000;
const PERCENT = 100;
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Distribution chart of the Insights tab. */
interface InsightChart {
  readonly title: string;
  readonly data: MeterSegment[];
  readonly unit: string;
}

/** Home: today at a glance, plus an Insights tab with counters and storage. */
@Component({
  selector: 'ac-home-page',
  imports: [
    RouterLink,
    ButtonModule,
    MeterGroupModule,
    TabsModule,
    TooltipModule,
    FileCollectionComponent,
    TagChipComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly dashboard = inject(DashboardApi);
  private readonly settings = inject(SettingsStore);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);
  protected readonly catalog = inject(CatalogStore);

  /** Query parameter: active tab. */
  readonly tab = input<string | undefined>(undefined);

  private readonly now = new Date();
  protected readonly todayLabel = DATE_FORMAT.format(this.now);
  private readonly dailyResource = resource({
    params: () => ({
      kind: parseDailyTextKind(this.settings.get('home_daily_text_kind')),
      language: parseDailyTextLanguage(this.settings.get('home_daily_text_language')),
    }),
    loader: ({ params, abortSignal }) => this.loadDaily(params.kind, params.language, abortSignal),
  });
  /** Undefined until the first answer. */
  protected readonly daily = computed(() => this.dailyResource.value());
  protected readonly refreshMetrics = signal(false);

  protected readonly today = resource({
    params: () => ({
      date: formatLocalDate(this.now),
      version: this.sync.version('files')() + this.sync.version('calendar')(),
    }),
    loader: ({ params, abortSignal }) => this.dashboard.today(params.date, abortSignal),
  });

  protected readonly metrics = resource({
    params: () => (this.tab() === 'insights' ? { refresh: this.refreshMetrics() } : undefined),
    loader: ({ params }) => this.dashboard.metrics(params.refresh),
  });

  protected readonly target = computed(() => this.settings.get('target_hourly_working_time'));
  protected readonly todayHours = computed(() =>
    (this.today.value()?.todayRecords ?? []).reduce((sum, record) => sum + record.hours, 0),
  );
  protected readonly weekHours = computed(() => this.today.value()?.weekHours ?? 0);
  protected readonly todayPercent = computed(() =>
    Math.min(PERCENT, (this.todayHours() / Math.max(this.target(), 1)) * PERCENT),
  );
  protected readonly weekPercent = computed(() =>
    Math.min(PERCENT, (this.weekHours() / Math.max(this.target() * WORK_DAYS, 1)) * PERCENT),
  );
  protected readonly due = computed(() => dueTasks(this.today.value()?.openTasks ?? [], this.now));
  protected readonly groups = computed(() => {
    const metrics = this.metrics.value();
    return metrics === undefined ? [] : kpiGroups(metrics);
  });
  protected readonly disk = computed(() => {
    const metrics = this.metrics.value();
    return metrics === undefined ? [] : diskSegments(metrics);
  });
  protected readonly diskTotal = computed(() => this.metrics.value()?.disk.total ?? 0);
  protected readonly diskFree = computed(() => this.metrics.value()?.disk.available ?? 0);
  protected readonly types = computed(() =>
    topSegments(this.metrics.value()?.fileTypes ?? [], typeColor),
  );
  protected readonly perProject = computed(() =>
    topSegments(this.metrics.value()?.filesPerProject ?? [], (name) =>
      this.catalog.projectColor(name),
    ),
  );
  protected readonly perTag = computed(() =>
    topSegments(this.metrics.value()?.filesPerTag ?? [], (name) => this.catalog.tagColor(name)),
  );
  protected readonly hoursPerProject = computed(() =>
    topSegments(this.metrics.value()?.hoursPerProject ?? [], (name) =>
      this.catalog.projectColor(name),
    ),
  );
  protected readonly mailCategories = computed(() =>
    mailCategorySegments(this.metrics.value()?.mailCategories ?? []),
  );
  protected readonly charts = computed<readonly InsightChart[]>(() => [
    { title: 'Hours per project', data: this.hoursPerProject(), unit: 'h' },
    { title: 'Files by type', data: this.types(), unit: '' },
    { title: 'Files per project', data: this.perProject(), unit: '' },
    { title: 'Files per tag', data: this.perTag(), unit: '' },
    { title: 'Received mail by category', data: this.mailCategories(), unit: '' },
  ]);

  constructor() {
    effect((onCleanup) => {
      if (this.daily()?.offline !== true) {
        return;
      }
      const retry = (): void => {
        this.dailyResource.reload();
      };
      const timer = setInterval(retry, OFFLINE_RETRY_MS);
      window.addEventListener('online', retry);
      onCleanup(() => {
        clearInterval(timer);
        window.removeEventListener('online', retry);
      });
    });
  }

  /**
   * Text of the day: greeting locally, else online, else an offline sentence.
   *
   * @param kind - Kind of text.
   * @param language - Language.
   * @param signal - Abort signal.
   * @returns Text to show.
   */
  private async loadDaily(
    kind: DailyTextKind,
    language: DailyTextLanguage,
    signal: AbortSignal,
  ): Promise<DailyText> {
    if (kind === 'greeting') {
      return greetingText(language, this.now);
    }
    try {
      return onlineText(kind, language, await this.dashboard.dailyText(kind, language, signal));
    } catch (error: unknown) {
      if (signal.aborted) {
        throw error;
      }
      return offlineText(kind, language, this.now);
    }
  }

  /**
   * Switch tab.
   *
   * @param tab - Tab value.
   */
  protected selectTab(tab: string | number | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: tab === 'insights' ? 'insights' : null },
      replaceUrl: true,
    });
  }

  /**
   * Total of meter segments.
   *
   * @param segments - Segments.
   * @returns Sum.
   */
  protected total(segments: readonly { value: number }[]): number {
    return segments.reduce((sum, segment) => sum + segment.value, 0);
  }

  /**
   * Format a chart value (hours keep one decimal).
   *
   * @param value - Value.
   * @param unit - Unit suffix ('h' for hours, '' for counts).
   * @returns Label.
   */
  protected amount(value: number, unit: string): string {
    return unit === 'h' ? `${value.toFixed(1)}h` : String(value);
  }

  /**
   * Format bytes.
   *
   * @param bytes - Byte count.
   * @returns Label.
   */
  protected bytes(bytes: number): string {
    return formatBytes(bytes);
  }

  /**
   * Describe how far a due date is.
   *
   * @param days - Days until due (negative when overdue).
   * @returns Label.
   */
  protected dueLabel(days: number): string {
    if (days < 0) {
      return `${String(-days)} day(s) overdue`;
    }
    return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${String(days)} days`;
  }
}

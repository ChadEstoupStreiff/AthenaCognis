import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { AppConfig } from '../../core/config/app-config';
import { DashboardApi } from '../../core/dashboard/dashboard.api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { FileCollectionComponent } from '../../shared/files/file-collection.component';
import { formatBytes } from '../../shared/pipes/bytes.pipe';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import { diskSegments, dueTasks, greeting, kpiTiles, topSegments, typeColor } from './home-model';

const WORK_DAYS = 5;
const PERCENT = 100;
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

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
  private readonly config = inject(AppConfig);
  protected readonly userName = computed(() => this.config.value().userName);

  /** Query parameter: active tab. */
  readonly tab = input<string | undefined>(undefined);

  private readonly now = new Date();
  protected readonly todayLabel = DATE_FORMAT.format(this.now);
  protected readonly hello = greeting(this.now);
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
  protected readonly tiles = computed(() => {
    const metrics = this.metrics.value();
    return metrics === undefined ? [] : kpiTiles(metrics);
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

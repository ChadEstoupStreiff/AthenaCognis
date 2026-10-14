import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EChartsCoreOption } from 'echarts/core';
import { SelectButtonModule } from 'primeng/selectbutton';
import { addDays, formatLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { DataSync } from '../../core/state/data-sync.service';
import { CalendarApi } from '../../core/time/calendar.api';
import { ChartComponent } from '../../shared/ui/chart.component';
import { groupBy, hoursByProject, hoursSeries, totalHours } from './time-model';

/** Range presets. */
type RangePreset = 'month' | 'quarter' | 'year';

const RANGE_OPTIONS = [
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'Last 3 months' },
  { value: 'year', label: 'Last 12 months' },
];
const QUARTER_DAYS = 90;
const YEAR_DAYS = 365;
const DONUT_RADIUS = ['48%', '75%'];
const HEATMAP_MAX_HOURS = 10;
const DECIMALS = 1;
const HEATMAP_CELL_PX = 14;

/**
 * Start date of a preset.
 *
 * @param preset - Preset.
 * @param today - Today.
 * @returns First day.
 */
function rangeStart(preset: RangePreset, today: Date): string {
  if (preset === 'month') {
    return formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
  }
  return formatLocalDate(addDays(today, -(preset === 'quarter' ? QUARTER_DAYS : YEAR_DAYS)));
}

/** Hours per project, per day, per month and a yearly heatmap. */
@Component({
  selector: 'ac-time-stats',
  imports: [FormsModule, SelectButtonModule, ChartComponent],
  templateUrl: './stats-panel.component.html',
  styleUrl: './time.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsPanelComponent {
  private readonly calendar = inject(CalendarApi);
  private readonly catalog = inject(CatalogStore);
  private readonly sync = inject(DataSync);
  private readonly today = new Date();

  protected readonly rangeOptions = RANGE_OPTIONS;
  protected readonly preset = signal<RangePreset>('month');
  protected readonly start = computed(() => rangeStart(this.preset(), this.today));
  protected readonly end = formatLocalDate(this.today);

  protected readonly records = resource({
    params: () => ({
      start: this.start(),
      end: this.end,
      version: this.sync.version('calendar')(),
    }),
    loader: ({ params, abortSignal }) =>
      this.calendar.search({ start: params.start, end: params.end }, abortSignal),
  });

  private readonly list = computed(() => this.records.value() ?? []);
  protected readonly total = computed(() => totalHours(this.list()).toFixed(DECIMALS));
  protected readonly days = computed(() => groupBy(this.list(), (record) => record.date).size);

  protected readonly donut = computed<EChartsCoreOption>(() => ({
    tooltip: { trigger: 'item', valueFormatter: (value: number) => `${value.toFixed(DECIMALS)} h` },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        type: 'pie',
        radius: DONUT_RADIUS,
        itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        data: hoursByProject(this.list()).map((entry) => ({
          name: entry.name,
          value: entry.count,
          itemStyle: { color: this.catalog.projectColor(entry.name) },
        })),
      },
    ],
  }));

  protected readonly perDay = computed(() => this.stacked('day'));
  protected readonly perMonth = computed(() => this.stacked('month'));

  protected readonly heatmap = computed<EChartsCoreOption>(() => {
    const byDay = [...groupBy(this.list(), (record) => record.date)].map(([date, records]) => [
      date,
      totalHours(records),
    ]);
    return {
      tooltip: {
        formatter: (params: { value: [string, number] }) =>
          `${params.value[0]}: ${params.value[1].toFixed(DECIMALS)} h`,
      },
      visualMap: {
        min: 0,
        max: HEATMAP_MAX_HOURS,
        show: false,
        inRange: { color: ['#f3e8fb', '#7700a7'] },
      },
      calendar: {
        range: [this.start(), this.end],
        cellSize: ['auto', HEATMAP_CELL_PX],
        top: 30,
        left: 40,
        right: 10,
        yearLabel: { show: false },
      },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: byDay }],
    };
  });

  /**
   * Stacked bars of hours per project.
   *
   * @param granularity - Days or months.
   * @returns Chart options.
   */
  private stacked(granularity: 'day' | 'month'): EChartsCoreOption {
    const series = hoursSeries(this.list(), this.start(), this.end, granularity);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: 40, right: 16, top: 16, bottom: 56 },
      xAxis: { type: 'category', data: series.labels },
      yAxis: { type: 'value', name: 'h' },
      dataZoom: granularity === 'day' ? [{ type: 'inside' }] : [],
      series: series.projects.map((project) => ({
        name: project,
        type: 'bar',
        stack: 'hours',
        data: series.values[project],
        itemStyle: { color: this.catalog.projectColor(project) },
      })),
    };
  }
}

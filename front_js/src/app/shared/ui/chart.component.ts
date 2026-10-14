import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import { ThemeService } from '../../core/theme/theme.service';

const DEFAULT_HEIGHT = 320;

/**
 * Load a tree-shaken ECharts build (only the charts the app uses).
 *
 * @returns The ECharts core module.
 */
async function loadEcharts(): Promise<typeof import('echarts/core')> {
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]);
  core.use([
    charts.BarChart,
    charts.PieChart,
    charts.HeatmapChart,
    components.GridComponent,
    components.TooltipComponent,
    components.LegendComponent,
    components.CalendarComponent,
    components.VisualMapComponent,
    components.DataZoomComponent,
    renderers.CanvasRenderer,
  ]);
  return core;
}

/** ECharts chart following the app theme (re-created when the theme flips). */
@Component({
  selector: 'ac-chart',
  imports: [NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: loadEcharts })],
  template: `
    @for (mode of [themeName()]; track mode) {
      <div
        echarts
        class="chart"
        [options]="themedOptions()"
        [theme]="mode"
        [style.height.px]="height()"
      ></div>
    }
  `,
  styles: `
    .chart {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartComponent {
  private readonly theme = inject(ThemeService);

  /** Chart options. */
  readonly options = input.required<EChartsCoreOption>();
  /** Height in pixels. */
  readonly height = input(DEFAULT_HEIGHT);

  protected readonly themeName = computed(() => (this.theme.dark() ? 'dark' : ''));
  protected readonly themedOptions = computed<EChartsCoreOption>(() => ({
    backgroundColor: 'transparent',
    ...this.options(),
  }));
}

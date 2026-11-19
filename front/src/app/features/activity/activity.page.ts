import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectButtonModule } from 'primeng/selectbutton';
import type { ActivityItem, DataSourceInfo, GenerationSpan, ScanProgress } from '@domain/contracts';
import {
  activityWindow,
  customWindow,
  defaultCustomDays,
  type ActivityRange,
  type ActivityWindow,
} from '../../core/activity/activity-range';
import { ActivityApi } from '../../core/activity/activity.api';
import { DataSync } from '../../core/state/data-sync.service';
import { latestValue } from '../../core/state/latest-value';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { mailTime } from '../mail/mail-model';
import { isExternalLink } from './lines';
import { readSourceCount, saveSourceCount } from './source-count';
import { progressLine, scanPercent } from './scan-progress';
import { GenerationPanelComponent } from './generation-panel.component';
import { GenerationSidebarComponent } from './generation-sidebar.component';
import { SourcePanelComponent } from './source-panel.component';

/** Scan progress refresh while a feed loads. */
const PROGRESS_POLL_MS = 500;

const RANGE_OPTIONS: { value: ActivityRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: '7 days' },
  { value: 'custom', label: 'Custom' },
];

/** Icon per activity kind; unknown kinds use their source icon. */
const KIND_ICONS: Readonly<Record<string, string>> = {
  received: 'pi pi-inbox',
  sent: 'pi pi-send',
  uploaded: 'pi pi-upload',
  summary: 'pi pi-sparkles',
  transcription: 'pi pi-microphone',
  ocr: 'pi pi-file',
  tree: 'pi pi-sitemap',
  completed: 'pi pi-check-circle',
  due: 'pi pi-calendar',
  started: 'pi pi-play',
  record: 'pi pi-clock',
  added: 'pi pi-plus-circle',
  app: 'pi pi-desktop',
  web: 'pi pi-globe',
  event: 'pi pi-calendar-clock',
  all_day: 'pi pi-calendar',
  modified: 'pi pi-file-edit',
  push: 'pi pi-upload',
  pull_request: 'pi pi-arrow-right-arrow-left',
  review: 'pi pi-eye',
  issue: 'pi pi-exclamation-circle',
  comment: 'pi pi-comment',
  branch: 'pi pi-share-alt',
  release: 'pi pi-tag',
};

/** Day-to-day activity: connected data sources and the feed of the selected one. */
@Component({
  selector: 'ac-activity-page',
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    DialogModule,
    ProgressBarModule,
    SelectButtonModule,
    EmptyStateComponent,
    GenerationPanelComponent,
    GenerationSidebarComponent,
    PageHeaderComponent,
    SourcePanelComponent,
  ],
  templateUrl: './activity.page.html',
  styleUrl: './activity.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityPage {
  private readonly api = inject(ActivityApi);
  private readonly router = inject(Router);
  private readonly sync = inject(DataSync);

  protected readonly rangeOptions = RANGE_OPTIONS;
  /** One placeholder tile per data source seen last visit. */
  protected readonly sourcePlaceholders = Array.from({ length: readSourceCount() }, (_, i) => i);
  protected readonly mailTime = mailTime;
  protected readonly progressLine = progressLine;
  protected readonly adding = signal(false);
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly range = signal<ActivityRange>('today');
  /** Activity generation timeline and picked day (sidebar ↔ results). */
  protected readonly span = signal<GenerationSpan>('daily');
  protected readonly picked = signal<Date>(new Date());
  /** Picked days of the custom range; second entry null while picking. */
  protected readonly customDays = signal<(Date | null)[]>(defaultCustomDays());
  protected readonly today = new Date();
  /** Window of the selected range, null while a custom range is incomplete. */
  private readonly window = computed<ActivityWindow | null>(() => {
    const range = this.range();
    if (range !== 'custom') {
      return activityWindow(range);
    }
    const [first, last] = this.customDays();
    return first && last ? customWindow(first, last) : null;
  });

  /** Mail and settings versions: sources and feeds follow both. */
  private readonly versions = computed(() => ({
    mail: this.sync.version('mail')(),
    settings: this.sync.version('settings')(),
  }));
  private readonly sourcesResource = resource({
    params: () => this.versions(),
    loader: () => this.api.sources(),
  });
  private readonly allSources = latestValue(this.sourcesResource, []);
  /** Sources on the Activity page (enabled or not). */
  protected readonly added = computed(() =>
    this.allSources().filter((source) => source.state === 'active' || source.state === 'disabled'),
  );
  /** Enabled sources, offered to activity generation. */
  protected readonly activeSources = computed(() => this.byState('active'));
  protected readonly available = computed(() => this.byState('available'));
  protected readonly inactive = computed(() => this.byState('inactive'));
  /** True once sources loaded; stays true across reloads so placeholders never come back. */
  protected readonly sourcesLoaded = linkedSignal<boolean, boolean>({
    source: () => this.sourcesResource.hasValue(),
    computation: (hasValue, previous) => hasValue || (previous?.value ?? false),
  });
  protected readonly incomingGroups = computed(() => [
    { title: 'Incoming · external services', items: this.incoming('external') },
    { title: 'Incoming · AthenaCognis', items: this.incoming('athenacognis') },
  ]);
  protected readonly selected = computed(
    () => this.added().find((source) => source.key === this.selectedKey()) ?? null,
  );

  protected readonly feed = resource({
    params: () => {
      const source = this.selected();
      const window = this.window();
      return source?.state === 'active' && window !== null
        ? { key: source.key, window, versions: this.versions() }
        : undefined;
    },
    loader: ({ params }) => this.api.feed(params.key, params.window),
  });
  protected readonly feedRows = computed<readonly ActivityItem[]>(() =>
    this.feed.hasValue() ? this.feed.value() : [],
  );
  /** Progress of the running scan, null when the source reports none. */
  protected readonly scan = signal<ScanProgress | null>(null);
  protected readonly scanPercent = computed(() => {
    const progress = this.scan();
    return progress === null ? 0 : scanPercent(progress);
  });

  constructor() {
    effect((onCleanup) => {
      const key = this.selected()?.key;
      this.scan.set(null);
      if (key === undefined || !this.feed.isLoading()) {
        return;
      }
      const timer = setInterval(() => void this.pollProgress(key), PROGRESS_POLL_MS);
      onCleanup(() => {
        clearInterval(timer);
      });
    });
    effect(() => {
      if (this.sourcesResource.hasValue()) {
        saveSourceCount(this.added().length);
      }
    });
  }

  /**
   * Select a source, or clear the selection when it is already selected.
   *
   * @param key - Source key.
   */
  protected toggle(key: string): void {
    this.selectedKey.update((current) => (current === key ? null : key));
  }

  /**
   * Open the in-app page of an activity.
   *
   * @param item - Activity.
   */
  protected open(item: ActivityItem): void {
    if (item.link === null) {
      return;
    }
    if (isExternalLink(item.link)) {
      window.open(item.link, '_blank', 'noopener');
      return;
    }
    void this.router.navigateByUrl(item.link);
  }

  /**
   * Add a set-up source, close the dialog and select it.
   *
   * @param source - Available source.
   */
  protected async add(source: DataSourceInfo): Promise<void> {
    await this.api.add(source.key);
    this.adding.set(false);
    this.selectedKey.set(source.key);
  }

  /**
   * Close the dialog and open the setup page of a source.
   *
   * @param source - Inactive source.
   */
  protected setUp(source: DataSourceInfo): void {
    this.adding.set(false);
    if (source.setup_link !== null) {
      void this.router.navigateByUrl(source.setup_link);
    }
  }

  /**
   * Icon of an activity.
   *
   * @param item - Activity.
   * @returns PrimeIcons class.
   */
  protected iconOf(item: ActivityItem): string {
    return KIND_ICONS[item.kind] ?? this.selected()?.icon ?? 'pi pi-circle';
  }

  /**
   * Read the scan progress of the loading feed.
   *
   * @param key - Source key.
   */
  private async pollProgress(key: string): Promise<void> {
    try {
      const progress = await this.api.progress(key);
      if (this.feed.isLoading() && this.selected()?.key === key) {
        this.scan.set(progress.running ? progress : null);
      }
    } catch {
      // Progress is a hint: a failed poll keeps the previous bar.
    }
  }

  /**
   * Sources in one state.
   *
   * @param state - Wanted state.
   * @returns Sources.
   */
  private byState(state: DataSourceInfo['state']): DataSourceInfo[] {
    return this.allSources().filter((source) => source.state === state);
  }

  /**
   * Incoming sources of one origin.
   *
   * @param origin - Wanted origin.
   * @returns Sources.
   */
  private incoming(origin: DataSourceInfo['origin']): DataSourceInfo[] {
    return this.byState('incoming').filter((source) => source.origin === origin);
  }
}

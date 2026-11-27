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
import { Router } from '@angular/router';
import type {
  DataSourceInfo,
  GenerationRequest,
  GenerationSpan,
  PeriodGeneration,
} from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { ActivityGenerationApi } from '../../core/activity/activity-generation.api';
import {
  generationRequest,
  periodOf,
  type GenerationContext,
} from '../../core/activity/activity-period';
import { periodOptions, scheduleDefaults } from '../../core/activity/generation-settings';
import { SettingsStore } from '../../core/settings/settings.store';
import { DataSync } from '../../core/state/data-sync.service';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import { DryRunDialogComponent } from './dry-run-dialog.component';
import { GenerationDialogComponent } from './generation-dialog.component';
import { isGenerating, noteBody, recordRange } from './generation-model';

/** Refresh of a running generation. */
const GENERATION_POLL_MS = 3000;

/** Summary generated for the picked day, week or month, and the generation form. */
@Component({
  selector: 'ac-generation-panel',
  imports: [
    ButtonModule,
    ProgressBarModule,
    MarkdownViewComponent,
    TagChipComponent,
    GenerationDialogComponent,
    DryRunDialogComponent,
  ],
  templateUrl: './generation-panel.component.html',
  styleUrl: './generation-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationPanelComponent {
  private readonly api = inject(ActivityGenerationApi);
  private readonly router = inject(Router);
  private readonly sync = inject(DataSync);
  private readonly settings = inject(SettingsStore);

  /** Active data sources offered by the form. */
  readonly sources = input.required<readonly DataSourceInfo[]>();
  /** Selected timeline. */
  readonly span = input.required<GenerationSpan>();
  /** Picked day (any day of the week or month for longer spans). */
  readonly picked = input.required<Date>();

  protected readonly noteBody = noteBody;
  protected readonly recordRange = recordRange;
  protected readonly period = computed(() =>
    periodOf(this.span(), this.picked(), periodOptions(this.settings.values())),
  );
  /** Form defaults from the timeline's schedule. */
  protected readonly defaults = computed(() =>
    scheduleDefaults(this.settings.values(), this.span()),
  );
  protected readonly formOpen = signal(false);
  /** Request previewed by the dry run popup; null when closed. */
  protected readonly dryRunRequest = signal<GenerationRequest | null>(null);

  /** Generation of the picked day, week or month. */
  protected readonly result = resource({
    params: () => ({ span: this.span(), day: this.period().key }),
    loader: ({ params }) => this.api.generation(params.span, params.day),
  });
  protected readonly generation = computed<PeriodGeneration | null>(() =>
    this.result.hasValue() ? this.result.value() : null,
  );
  protected readonly run = computed(() => this.generation()?.task ?? null);
  protected readonly generating = computed(() => isGenerating(this.run()));
  protected readonly hasResults = computed(() => {
    const generation = this.generation();
    return generation !== null && (generation.note !== null || generation.records.length > 0);
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.generating()) {
        return;
      }
      const timer = setInterval(() => {
        this.result.reload();
      }, GENERATION_POLL_MS);
      onCleanup(() => {
        clearInterval(timer);
        // Finished: notes, time entries, projects and the calendar dots changed.
        this.sync.invalidate('notes', 'calendar', 'projects', 'generation');
      });
    });
  }

  /**
   * Queue the generation asked by the form.
   *
   * @param context - Context, outputs and custom instruction.
   */
  protected async generate(context: GenerationContext): Promise<void> {
    await this.api.generate(generationRequest(this.period(), context));
    this.result.reload();
    this.sync.invalidate('generation');
  }

  /**
   * Preview the prompt of the generation asked by the form.
   *
   * @param context - Context, outputs and custom instruction.
   */
  protected previewPrompts(context: GenerationContext): void {
    this.dryRunRequest.set(generationRequest(this.period(), context));
  }

  /**
   * Open the generated note in Notes.
   *
   * @param path - Note path.
   */
  protected openNote(path: string): void {
    void this.router.navigate(['/notes'], { queryParams: { path } });
  }
}

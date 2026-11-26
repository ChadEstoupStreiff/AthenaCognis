import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { JOB_SERVICE_LABELS, type JobService, type JobState } from '@domain/contracts';
import { type FileKind, supportsOcr, supportsTranscription } from '@domain/files';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { DocumentTreeComponent } from './document-tree.component';
import { SummaryBlockComponent } from './summary-block.component';

/** Severity of each job state tag. */
const STATE_SEVERITY: Readonly<Record<JobState, 'info' | 'warn' | 'success' | 'danger'>> = {
  PENDING: 'info',
  IN_PROGRESS: 'warn',
  COMPLETED: 'success',
  FAILED: 'danger',
};

/** AI subtabs of a file: summary (with jobs) and section tree. */
type AiSubtab = 'summary' | 'tree';

/** Summary, job history and section tree of a file. */
@Component({
  selector: 'ac-ai-tab',
  imports: [ButtonModule, TabsModule, TagModule, SummaryBlockComponent, DocumentTreeComponent],
  templateUrl: './ai-tab.component.html',
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiTabComponent {
  private readonly details = inject(FileDetailsApi);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);

  /** Shared path. */
  readonly path = input.required<string>();
  /** Show data only: no inputs or actions (side panel). */
  readonly readonly = input(false);
  /** File kind. */
  readonly kind = input.required<FileKind>();

  /** Active subtab. */
  protected readonly subtab = signal<AiSubtab>('summary');

  private readonly canOcr = computed(() => supportsOcr(this.kind()));
  private readonly canTranscribe = computed(() => supportsTranscription(this.kind()));
  protected readonly severity = STATE_SEVERITY;
  protected readonly labels = JOB_SERVICE_LABELS;

  private readonly params = computed(() => ({
    path: this.path(),
    version: this.sync.version('jobs')(),
  }));

  protected readonly history = resource({
    params: this.params,
    loader: ({ params }) => this.loadHistory(params.path),
  });

  /**
   * Switch subtab.
   *
   * @param value - Tab value.
   */
  protected selectSubtab(value: string | number | undefined): void {
    this.subtab.set(value === 'tree' ? 'tree' : 'summary');
  }

  /**
   * Queue a job.
   *
   * @param service - Job service.
   */
  protected async ask(service: JobService): Promise<void> {
    await this.details.ask(service, this.path());
    this.notify.info(`${JOB_SERVICE_LABELS[service]} requested`);
  }

  /**
   * Latest run of each relevant service.
   *
   * @param path - Shared path.
   * @returns Service and latest run.
   */
  private async loadHistory(
    path: string,
  ): Promise<{ service: JobService; state: JobState; result: string | null; added: string }[]> {
    const services: JobService[] = ['summarize', 'tree', 'preview'];
    if (this.canOcr()) {
      services.unshift('ocr');
    }
    if (this.canTranscribe()) {
      services.unshift('transcription');
    }
    const runs = await Promise.all(
      services.map(async (service) => ({
        service,
        tasks: await this.details.tasks(service, path),
      })),
    );
    return runs.flatMap(({ service, tasks }) => {
      const latest = [...tasks].sort((left, right) => right.added.localeCompare(left.added))[0];
      return latest === undefined
        ? []
        : [{ service, state: latest.state, result: latest.result, added: latest.added }];
    });
  }
}

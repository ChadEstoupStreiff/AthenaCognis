import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  resource,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  JOB_SERVICE_LABELS,
  type JobService,
  type JobState,
  type OcrRecord,
  type ParsedOcr,
} from '@domain/contracts';
import { type FileKind, supportsOcr, supportsTranscription } from '@domain/files';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { SummaryBlockComponent } from './summary-block.component';

/** Severity of each job state tag. */
const STATE_SEVERITY: Readonly<Record<JobState, 'info' | 'warn' | 'success' | 'danger'>> = {
  PENDING: 'info',
  IN_PROGRESS: 'warn',
  COMPLETED: 'success',
  FAILED: 'danger',
};

/** Summary, OCR, transcription and job history of a file. */
@Component({
  selector: 'ac-ai-tab',
  imports: [FormsModule, ButtonModule, TagModule, ToggleSwitchModule, SummaryBlockComponent],
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
  /** File kind. */
  readonly kind = input.required<FileKind>();
  /** OCR record (loaded by the page, shared with the overlay). */
  readonly ocrRecord = input<OcrRecord | null>(null);
  /** Parsed OCR. */
  readonly ocr = input<ParsedOcr>({ text: '', boxes: [] });
  /** Show OCR boxes on the image (two-way). */
  readonly showBoxes = model(false);
  /** Show OCR confidences (two-way). */
  readonly showScores = model(false);

  protected readonly canOcr = computed(() => supportsOcr(this.kind()));
  protected readonly canTranscribe = computed(() => supportsTranscription(this.kind()));
  protected readonly severity = STATE_SEVERITY;
  protected readonly labels = JOB_SERVICE_LABELS;

  private readonly params = computed(() => ({
    path: this.path(),
    version: this.sync.version('jobs')(),
  }));

  protected readonly transcription = resource({
    params: () => (this.canTranscribe() ? this.params() : undefined),
    loader: ({ params }) => this.details.transcription(params.path),
  });
  protected readonly history = resource({
    params: this.params,
    loader: ({ params }) => this.loadHistory(params.path),
  });

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
    const services: JobService[] = ['summarize', 'preview'];
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

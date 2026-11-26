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
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  JOB_SERVICE_LABELS,
  type JobService,
  type OcrRecord,
  type ParsedOcr,
} from '@domain/contracts';
import { type FileKind, supportsOcr, supportsTranscription } from '@domain/files';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';

/** Text extracted from a media file, shown under its preview: OCR and caption (images), transcription (audio, video). */
@Component({
  selector: 'ac-media-text',
  imports: [FormsModule, ButtonModule, ToggleSwitchModule],
  templateUrl: './media-text.component.html',
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaTextComponent {
  private readonly details = inject(FileDetailsApi);
  private readonly notify = inject(NotifyService);
  private readonly sync = inject(DataSync);

  /** Shared path. */
  readonly path = input.required<string>();
  /** Show data only: no actions (side panel). */
  readonly readonly = input(false);
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

  protected readonly transcription = resource({
    params: () =>
      this.canTranscribe()
        ? { path: this.path(), version: this.sync.version('jobs')() }
        : undefined,
    loader: ({ params }) => this.details.transcription(params.path),
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
}

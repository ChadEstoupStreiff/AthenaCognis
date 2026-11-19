import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import {
  JOB_SERVICES,
  type JobService,
  type JobState,
  type JobTask,
  MAIL_JOB_SERVICES,
} from '@domain/contracts';
import { fileNameOf } from '@domain/files';
import { ApiClient, backendUrl } from '../../core/api/api-client';
import { jobFailure } from '../../core/jobs/job-error';
import { Router } from '@angular/router';
import { latestRuns } from '../../core/jobs/jobs-overview';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PeekService } from '../../core/files/peek.service';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';

const SERVICE_LABELS: Readonly<Record<JobService, string>> = {
  ocr: 'OCR & captions',
  transcription: 'Transcription',
  summarize: 'Summaries',
  tree: 'Section trees',
  preview: 'Previews',
  'mail-preview': 'Mail Previews',
};
const STATE_SEVERITY: Readonly<Record<JobState, 'info' | 'warn' | 'success' | 'danger'>> = {
  PENDING: 'warn',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
};
const ROWS = 50;

/** Background jobs page: daemons and their queues. */
@Component({
  selector: 'ac-jobs-page',
  imports: [
    FormsModule,
    ButtonModule,
    SelectButtonModule,
    TableModule,
    TagModule,
    RelativeDatePipe,
  ],
  templateUrl: './jobs.page.html',
  styleUrl: './jobs.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobsPage {
  private readonly api = inject(ApiClient);
  protected readonly jobs = inject(JobsStore);
  protected readonly peek = inject(PeekService);
  private readonly router = inject(Router);

  protected readonly rows = ROWS;
  protected readonly services = JOB_SERVICES.map((value) => ({
    value,
    label: SERVICE_LABELS[value],
  }));
  protected readonly service = signal<JobService>('summarize');
  protected readonly onlyOpen = signal(false);

  protected readonly tasks = resource({
    params: () => this.service(),
    loader: async ({ params: service }) =>
      latestRuns(await this.api.get<JobTask[]>(backendUrl(`/${service}/tasks`), { silent: true })),
  });
  protected readonly visibleTasks = computed(() =>
    [...(this.tasks.value() ?? [])]
      .filter(
        (task) =>
          !this.onlyOpen() ||
          task.state === 'PENDING' ||
          task.state === 'IN_PROGRESS' ||
          task.state === 'FAILED',
      )
      .sort((left, right) => right.added.localeCompare(left.added)),
  );
  protected readonly status = computed(
    () =>
      this.jobs.overview.value()?.services.find((item) => item.service === this.service()) ?? null,
  );

  /** Refresh the table in place on each jobs poll (no reset to the loading state). */
  constructor() {
    effect(() => {
      this.jobs.overview.value();
      untracked(() => this.tasks.reload());
    });
  }

  /**
   * Label of a service.
   *
   * @param service - Service.
   * @returns Label.
   */
  protected label(service: JobService): string {
    return SERVICE_LABELS[service];
  }

  /**
   * Tag severity of a state.
   *
   * @param state - State.
   * @returns Severity.
   */
  protected severity(state: JobState): 'info' | 'warn' | 'success' | 'danger' {
    return STATE_SEVERITY[state];
  }

  /**
   * Readable reason of a failed task.
   *
   * @param task - Task.
   * @returns Reason, or null when the task did not fail.
   */
  protected failure(task: JobTask): string | null {
    return jobFailure(task);
  }

  /**
   * Whether the selected service works on mails.
   *
   * @returns True for Mail Preview.
   */
  protected isMailService(): boolean {
    return MAIL_JOB_SERVICES.has(this.service());
  }

  /**
   * Name of a task: mail subject for mail jobs, file name otherwise.
   *
   * @param task - Task.
   * @returns Name.
   */
  protected taskName(task: JobTask): string {
    return task.label ?? this.nameOf(task.file);
  }

  /**
   * Name of the item being processed (mail jobs already report a subject).
   *
   * @param running - Running file path or mail subject.
   * @returns Name.
   */
  protected runningName(running: string): string {
    return MAIL_JOB_SERVICES.has(this.service()) ? running : this.nameOf(running);
  }

  /**
   * Open a task's item: the mail in Mail, or the file peek.
   *
   * @param task - Task.
   */
  protected openTask(task: JobTask): void {
    if (MAIL_JOB_SERVICES.has(this.service())) {
      void this.router.navigate(['/mail'], { queryParams: { open: task.file } });
      return;
    }
    this.peek.open(task.file);
  }

  /**
   * File name of a path.
   *
   * @param path - Path.
   * @returns Name.
   */
  protected nameOf(path: string): string {
    return fileNameOf(path);
  }
}

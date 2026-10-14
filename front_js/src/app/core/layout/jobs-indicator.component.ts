import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PopoverModule } from 'primeng/popover';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { JOB_SERVICE_LABELS } from '@domain/contracts';
import { fileNameOf } from '@domain/files';
import { JobsStore } from '../jobs/jobs.store';
import { TriathleteComponent } from './triathlete.component';

const PERCENT = 100;
const MAX_OPERATIONS = 8;

/** Top-bar button with background jobs and front-side operations. */
@Component({
  selector: 'ac-jobs-indicator',
  imports: [PopoverModule, ProgressBarModule, TooltipModule, TriathleteComponent],
  templateUrl: './jobs-indicator.component.html',
  styleUrl: './jobs-indicator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobsIndicatorComponent {
  protected readonly jobs = inject(JobsStore);
  protected readonly labels = JOB_SERVICE_LABELS;

  protected readonly services = computed(() => this.jobs.overview.value()?.services ?? []);
  protected readonly operations = computed(() => this.jobs.operations().slice(0, MAX_OPERATIONS));
  protected readonly running = computed(
    () => this.operations().filter((operation) => operation.status === 'running').length,
  );
  protected readonly active = computed(
    () => (this.jobs.overview.value()?.activeCount ?? 0) + this.running(),
  );
  protected readonly dead = computed(() =>
    this.services().some((service) => service.health === 'DEAD'),
  );

  /**
   * File name for display.
   *
   * @param path - Path or null.
   * @returns Name.
   */
  protected fileName(path: string | null): string {
    return path === null ? '' : fileNameOf(path);
  }

  /**
   * Progress percentage of an operation.
   *
   * @param done - Done steps.
   * @param total - Total steps.
   * @returns Percentage.
   */
  protected percent(done: number, total: number): number {
    return total === 0 ? 0 : Math.round((done / total) * PERCENT);
  }
}

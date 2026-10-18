import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { AiActionsDialogComponent } from './ai-actions-dialog.component';
import { RelationsDialogComponent } from './relations-dialog.component';

/** Floating actions for the selected files. */
@Component({
  selector: 'ac-file-bulk-bar',
  imports: [ButtonModule, TooltipModule, RelationsDialogComponent, AiActionsDialogComponent],
  templateUrl: './file-bulk-bar.component.html',
  styleUrl: './file-bulk-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileBulkBarComponent {
  private readonly files = inject(FilesApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);

  /** Selected paths (two-way). */
  readonly selection = model<readonly string[]>([]);
  /** Every path of the current view (for "select all"). */
  readonly allPaths = input<readonly string[]>([]);

  protected readonly count = computed(() => this.selection().length);
  protected readonly allSelected = computed(
    () => this.allPaths().length > 0 && this.count() === this.allPaths().length,
  );
  protected readonly relationsOpen = signal(false);
  protected readonly aiOpen = signal(false);
  protected readonly busy = signal(false);

  /** Select every file, or clear. */
  protected toggleAll(): void {
    this.selection.set(this.allSelected() ? [] : [...this.allPaths()]);
  }

  /** Download the selection as a zip. */
  protected async download(): Promise<void> {
    await this.files.downloadZip(this.selection());
  }

  /** Open the assistant with the selection attached. */
  protected chat(): void {
    void this.router.navigate(['/assistant'], { queryParams: { attach: this.selection() } });
  }

  /** Confirm and delete the selection. */
  protected remove(): void {
    const paths = this.selection();
    this.confirm.confirm({
      header: 'Delete files',
      message: `Delete ${String(paths.length)} file(s)? Their notes, OCR, summaries and links are deleted too. This cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.deleteNow(paths),
    });
  }

  /**
   * Delete files and report failures.
   *
   * @param paths - Files to delete.
   */
  private async deleteNow(paths: readonly string[]): Promise<void> {
    this.busy.set(true);
    try {
      const results = await this.files.delete(paths);
      const failed = results.filter((result) => !result.ok);
      this.selection.set(failed.map((result) => result.path));
      if (failed.length > 0) {
        this.notify.warn(
          `${String(failed.length)} file(s) could not be deleted.`,
          failed[0]?.message,
        );
      } else {
        this.notify.success(`${String(paths.length)} file(s) deleted.`);
      }
    } finally {
      this.busy.set(false);
    }
  }
}

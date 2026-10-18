import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TaskDetail, TaskSummary } from '@domain/contracts';
import { fileNameOf, fileKindOf, FILE_KIND_ICONS } from '@domain/files';
import { formatLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { PeekService } from '../../core/files/peek.service';
import { ContactAvatarComponent } from '../../shared/ui/contact-avatar.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { RelationChipsComponent } from '../../shared/ui/relation-chips.component';
import { blockersOf, dueDay, priorityOf } from './work-model';

const ISO_DATE_LENGTH = 10;

/** Read-only view of a task (the dialog switches to the form on Edit). */
@Component({
  selector: 'ac-task-details',
  imports: [RouterLink, ContactAvatarComponent, MarkdownViewComponent, RelationChipsComponent],
  templateUrl: './task-details.component.html',
  styleUrl: './task-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDetailsComponent {
  private readonly catalog = inject(CatalogStore);
  protected readonly peek = inject(PeekService);

  /** Task shown. */
  readonly task = input.required<TaskDetail>();
  /** Every task (dependencies and dependents). */
  readonly allTasks = input<readonly TaskSummary[]>([]);

  protected readonly priority = computed(() => priorityOf(this.task().priority));
  private readonly byId = computed(() => new Map(this.allTasks().map((item) => [item.id, item])));
  protected readonly blockers = computed(() => blockersOf(this.task(), this.byId()));
  protected readonly dependencies = computed(() =>
    this.task().dependencies.flatMap((id) => this.byId().get(id) ?? []),
  );
  protected readonly dependents = computed(() =>
    this.allTasks().filter((item) => item.dependencies.includes(this.task().id)),
  );
  protected readonly contacts = computed(() => {
    const names = new Map(this.catalog.contactList().map((contact) => [contact.id, contact.name]));
    return this.task().contacts.map((id) => ({ id, name: names.get(id) ?? 'Unknown' }));
  });
  protected readonly files = computed(() =>
    this.task().files.map((path) => ({
      path,
      name: fileNameOf(path),
      icon: FILE_KIND_ICONS[fileKindOf(path)],
    })),
  );
  protected readonly overdue = computed(() => {
    const due = dueDay(this.task());
    return this.task().completed === null && due !== null && due < formatLocalDate(new Date());
  });

  /**
   * Day part of a backend datetime.
   *
   * @param value - ISO datetime or null.
   * @returns `YYYY-MM-DD`, or an empty string.
   */
  protected day(value: string | null): string {
    return value === null ? '' : value.slice(0, ISO_DATE_LENGTH);
  }
}

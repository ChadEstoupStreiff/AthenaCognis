import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import {
  TASK_PRIORITIES,
  type TaskDetail,
  type TaskSummary,
  type TaskUpsert,
} from '@domain/contracts';
import { fileNameOf } from '@domain/files';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { NotifyService } from '../../core/notify/notify.service';
import { DataSync } from '../../core/state/data-sync.service';
import { WorkApi } from '../../core/work/work.api';
import { FilePickerDialogComponent } from '../../shared/files/file-picker-dialog.component';
import { viewerCommands } from '../../shared/files/file-row';
import { AiTextareaComponent } from '../../shared/ui/ai-textarea.component';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';
import { TaskDetailsComponent } from './task-details.component';
import { blockersOf, dependentsOf } from './work-model';

/** Editable form state. */
interface TaskForm {
  title: string;
  description: string;
  priority: number;
  start: Date | null;
  due: Date | null;
  projects: string[];
  tags: string[];
  contacts: string[];
  dependencies: string[];
  files: string[];
}

const MIDNIGHT = 'T00:00:00';
const ISO_DATE_LENGTH = 10;

/**
 * Backend datetime of a day.
 *
 * @param date - Day or null.
 * @returns ISO datetime, or null.
 */
function toDateTime(date: Date | null): string | null {
  return date === null ? null : formatLocalDate(date) + MIDNIGHT;
}

/**
 * Day of a backend datetime.
 *
 * @param value - ISO datetime or null.
 * @returns Date, or null.
 */
function fromDateTime(value: string | null): Date | null {
  return value === null ? null : parseLocalDate(value.slice(0, ISO_DATE_LENGTH));
}

/** Show a task (Edit switches to the form), or create one. */
@Component({
  selector: 'ac-task-dialog',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DatePickerModule,
    DialogModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    TooltipModule,
    AiTextareaComponent,
    FilePickerDialogComponent,
    TagChipComponent,
    TaskDetailsComponent,
  ],
  templateUrl: './task-dialog.component.html',
  styleUrl: './task-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDialogComponent {
  private readonly work = inject(WorkApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly sync = inject(DataSync);
  protected readonly catalog = inject(CatalogStore);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Task to edit (`null` creates). */
  readonly task = input<TaskDetail | null>(null);
  /** Column receiving a new task. */
  readonly columnId = input<string | null>(null);
  /** Every task (dependencies). */
  readonly allTasks = input<readonly TaskSummary[]>([]);
  /** Projects preselected when creating. */
  readonly defaultProjects = input<readonly string[]>([]);

  /** Latest version of the task (refreshed after every change). */
  private readonly live = resource({
    params: () => {
      const id = this.task()?.id;
      return id === undefined || !this.visible()
        ? undefined
        : { id, version: this.sync.version('tasks')() };
    },
    loader: ({ params }) => this.work.task(params.id),
  });
  protected readonly current = linkedSignal<
    { task: TaskDetail | null; live: TaskDetail | undefined },
    TaskDetail | null
  >({
    source: () => ({
      task: this.task(),
      live: this.live.hasValue() ? this.live.value() : undefined,
    }),
    computation: ({ task, live }, previous) => {
      if (task === null) {
        return null;
      }
      if (live?.id === task.id) {
        return live;
      }
      const kept: TaskDetail | null = previous === undefined ? null : previous.value;
      return kept !== null && kept.id === task.id ? kept : task;
    },
  });
  protected readonly form = signal<TaskForm>(this.emptyForm());
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly picking = signal(false);
  protected readonly priorities = [...TASK_PRIORITIES];
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly tagOptions = computed(() => this.catalog.tagList().map((tag) => tag.name));
  protected readonly contactOptions = computed(() =>
    this.catalog.contactList().map((contact) => ({ label: contact.name, value: contact.id })),
  );
  protected readonly dependencyOptions = computed(() => {
    const id = this.current()?.id;
    const excluded =
      id === undefined ? new Set<string>() : new Set([id, ...dependentsOf(id, this.allTasks())]);
    return this.allTasks()
      .filter((candidate) => !excluded.has(candidate.id))
      .map((candidate) => ({
        label: `${candidate.completed === null ? '○' : '✓'} ${candidate.title}`,
        value: candidate.id,
      }));
  });
  protected readonly blockers = computed(() => {
    const task = this.current();
    return task === null
      ? []
      : blockersOf(task, new Map(this.allTasks().map((item) => [item.id, item])));
  });

  /** Open existing tasks on their details, new ones on the form. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.editing.set(this.task() === null);
          this.form.set(this.initialForm());
        });
      }
    });
  }

  /** Switch from the details to the form. */
  protected startEditing(): void {
    this.form.set(this.initialForm());
    this.editing.set(true);
  }

  /** Leave the form: back to the details, or close when creating. */
  protected cancel(): void {
    if (this.current() === null) {
      this.visible.set(false);
      return;
    }
    this.editing.set(false);
  }

  /**
   * Patch the form.
   *
   * @param patch - Changed fields.
   */
  protected patch(patch: Partial<TaskForm>): void {
    this.form.update((form) => ({ ...form, ...patch }));
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

  /**
   * Viewer route of a file.
   *
   * @param path - Path.
   * @returns Router commands.
   */
  protected viewerOf(path: string): string[] {
    return viewerCommands(path);
  }

  /**
   * Attach picked files.
   *
   * @param paths - Picked files.
   */
  protected attach(paths: readonly string[]): void {
    this.patch({ files: [...new Set([...this.form().files, ...paths])] });
  }

  /** Save the task (new tasks are added to the column). */
  protected async save(): Promise<void> {
    const form = this.form();
    if (form.title.trim() === '') {
      this.notify.warn('A title is required.');
      return;
    }
    this.saving.set(true);
    try {
      await this.persist(this.toUpsert(form));
      if (this.current() === null) {
        this.visible.set(false);
      } else {
        this.editing.set(false);
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Toggle completion. */
  protected async toggleDone(): Promise<void> {
    const task = this.current();
    if (task !== null) {
      await this.work.toggleComplete(task.id);
    }
  }

  /** Confirm and delete. */
  protected remove(): void {
    const task = this.current();
    if (task === null) {
      return;
    }
    this.confirm.confirm({
      header: 'Delete task',
      message: `Delete “${task.title}”?`,
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () =>
        void this.work.deleteTask(task.id).then(() => {
          this.visible.set(false);
        }),
    });
  }

  /**
   * Create or update.
   *
   * @param body - Task body.
   */
  private async persist(body: TaskUpsert): Promise<void> {
    const task = this.current();
    if (task !== null) {
      await this.work.updateTask(task.id, { ...body, calendars: task.calendars });
      return;
    }
    const created = await this.work.createTask(body);
    const column = this.columnId();
    if (column !== null) {
      await this.work.addTaskToColumn(column, created.id);
    }
  }

  /**
   * Build the API body.
   *
   * @param form - Form.
   * @returns Body.
   */
  private toUpsert(form: TaskForm): TaskUpsert {
    return {
      title: form.title.trim(),
      description: form.description === '' ? null : form.description,
      priority: form.priority,
      start_date: toDateTime(form.start),
      end_date: toDateTime(form.due),
      projects: form.projects,
      tags: form.tags,
      contacts: form.contacts,
      dependencies: form.dependencies,
      files: form.files,
      calendars: [],
    };
  }

  /**
   * Form of the current task, or a blank one.
   *
   * @returns Form.
   */
  private initialForm(): TaskForm {
    const task = this.current();
    if (task === null) {
      return this.emptyForm();
    }
    return {
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      start: fromDateTime(task.start_date),
      due: fromDateTime(task.end_date),
      projects: [...task.projects],
      tags: [...task.tags],
      contacts: [...task.contacts],
      dependencies: [...task.dependencies],
      files: [...task.files],
    };
  }

  /**
   * Blank form.
   *
   * @returns Form.
   */
  private emptyForm(): TaskForm {
    return {
      title: '',
      description: '',
      priority: 1,
      start: null,
      due: null,
      projects: [...this.defaultProjects()],
      tags: [],
      contacts: [],
      dependencies: [],
      files: [],
    };
  }
}

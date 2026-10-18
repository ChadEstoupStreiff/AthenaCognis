import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import type { RepresentationMode, TaskDetail, TodoItem } from '@domain/contracts';
import { representationModeOf } from '@domain/contracts';
import { CaptureService, NO_DEFAULTS } from '../../core/capture/capture.service';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { FilesApi } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';
import { ContactsApi } from '../../core/people/contacts.api';
import { ProjectsApi } from '../../core/projects/projects.api';
import { SettingsStore } from '../../core/settings/settings.store';
import { AutosaveController } from '../../core/state/autosave';
import { DataSync } from '../../core/state/data-sync.service';
import { CalendarApi } from '../../core/time/calendar.api';
import { WorkApi } from '../../core/work/work.api';
import { FileBulkBarComponent } from '../../shared/files/file-bulk-bar.component';
import { FileCollectionComponent } from '../../shared/files/file-collection.component';
import { FilePickerDialogComponent } from '../../shared/files/file-picker-dialog.component';
import { ChartComponent } from '../../shared/ui/chart.component';
import { ContactAvatarComponent } from '../../shared/ui/contact-avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { MarkdownEditorComponent } from '../../shared/ui/markdown-editor.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import { SaveStatusComponent } from '../../shared/ui/save-status.component';
import { hoursSeries, totalHours } from '../time/time-model';
import { TaskDialogComponent } from '../work/task-dialog.component';
import { priorityOf } from '../work/work-model';
import { ProjectDialogComponent } from './project-dialog.component';
import { TodoListComponent } from './todo-list.component';

const TABS = ['overview', 'files', 'time', 'people', 'tasks'] as const;
const DECIMALS = 1;
const ALL_START = '1970-01-01';
const ALL_END = '2999-12-31';

/** Project hub: overview (notes, TODO), files, time, people and tasks. */
@Component({
  selector: 'ac-project-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    SelectModule,
    TabsModule,
    ChartComponent,
    ContactAvatarComponent,
    EmptyStateComponent,
    FileBulkBarComponent,
    FileCollectionComponent,
    FilePickerDialogComponent,
    MarkdownEditorComponent,
    MarkdownViewComponent,
    ProjectDialogComponent,
    SaveStatusComponent,
    TaskDialogComponent,
    TodoListComponent,
  ],
  templateUrl: './project.page.html',
  styleUrl: './project.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectPage {
  private readonly projects = inject(ProjectsApi);
  private readonly files = inject(FilesApi);
  private readonly calendar = inject(CalendarApi);
  private readonly contacts = inject(ContactsApi);
  private readonly work = inject(WorkApi);
  private readonly settings = inject(SettingsStore);
  private readonly sync = inject(DataSync);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly capture = inject(CaptureService);
  protected readonly catalog = inject(CatalogStore);

  /** Route parameter: project name. */
  readonly name = input.required<string>();
  /** Query parameter: tab. */
  readonly tab = input<string | undefined>(undefined);

  protected readonly activeTab = computed(
    () => TABS.find((tab) => tab === this.tab()) ?? 'overview',
  );
  protected readonly editing = signal(false);
  protected readonly picking = signal(false);
  protected readonly selection = signal<readonly string[]>([]);
  protected readonly notes = signal('');
  protected readonly todo = signal<readonly TodoItem[]>([]);
  protected readonly openTask = signal<TaskDetail | null>(null);
  protected readonly view = computed<RepresentationMode>(() =>
    representationModeOf(this.settings.get('projects_default_representation_mode')),
  );

  protected readonly project = resource({
    params: () => ({ name: this.name(), version: this.sync.version('projects')() }),
    loader: ({ params }) => this.projects.get(params.name),
  });
  protected readonly projectFiles = resource({
    params: () => ({ name: this.name(), version: this.sync.version('files')() }),
    loader: ({ params }) => this.projects.files(params.name),
  });
  protected readonly records = resource({
    params: () =>
      this.activeTab() === 'time'
        ? { name: this.name(), version: this.sync.version('calendar')() }
        : undefined,
    loader: ({ params }) =>
      this.calendar.search({ start: ALL_START, end: ALL_END, project: params.name }),
  });
  protected readonly people = resource({
    params: () => ({ name: this.name(), version: this.sync.version('contacts')() }),
    loader: ({ params }) => this.projects.contacts(params.name),
  });
  protected readonly tasks = resource({
    params: () =>
      this.activeTab() === 'tasks'
        ? { name: this.name(), version: this.sync.version('kanban')() }
        : undefined,
    loader: ({ params }) => this.projectTasks(params.name),
  });
  protected readonly allTasks = resource({
    params: () => this.sync.version('tasks')(),
    loader: () => this.work.tasks(),
  });

  protected readonly hours = computed(() =>
    totalHours(this.records.value() ?? []).toFixed(DECIMALS),
  );
  protected readonly candidates = computed(() => {
    const linked = new Set((this.people.value() ?? []).map((person) => person.id));
    return this.catalog.contactList().filter((contact) => !linked.has(contact.id));
  });
  protected readonly monthly = computed<EChartsCoreOption>(() => {
    const records = this.records.value() ?? [];
    const dates = records.map((record) => record.date).sort();
    const series = hoursSeries(records, dates[0] ?? ALL_START, dates.at(-1) ?? ALL_START, 'month');
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 16, top: 16, bottom: 32 },
      xAxis: { type: 'category', data: series.labels },
      yAxis: { type: 'value', name: 'h' },
      series: [
        {
          type: 'bar',
          data: series.values[this.name()] ?? [],
          itemStyle: { color: this.catalog.projectColor(this.name()) },
        },
      ],
    };
  });

  protected readonly notesSave = new AutosaveController<{ name: string; notes: string }>(
    (value) => this.projects.saveNotes(value.name, value.notes),
    inject(DestroyRef),
  );
  protected readonly todoSave = new AutosaveController<{
    name: string;
    items: readonly TodoItem[];
  }>((value) => this.projects.saveTodo(value.name, value.items), inject(DestroyRef));

  /** Load notes/TODO, and preselect this project for new captures. */
  constructor() {
    effect(() => {
      const project = this.project.value();
      if (project !== undefined) {
        untracked(() => {
          this.notes.set(project.notes);
          this.todo.set(project.todo);
        });
      }
    });
    effect(() => {
      const name = this.name();
      untracked(() => {
        this.capture.setDefaults({ ...NO_DEFAULTS, projects: [name] });
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.capture.setDefaults(NO_DEFAULTS);
    });
  }

  /**
   * Switch tab.
   *
   * @param tab - Tab.
   */
  protected selectTab(tab: string | number | undefined): void {
    void this.router.navigate([], {
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Record a notes edit.
   *
   * @param notes - Markdown.
   */
  protected editNotes(notes: string): void {
    this.notes.set(notes);
    this.notesSave.schedule({ name: this.name(), notes });
  }

  /**
   * Record a TODO edit.
   *
   * @param items - Items.
   */
  protected editTodo(items: TodoItem[]): void {
    this.todo.set(items);
    this.todoSave.schedule({ name: this.name(), items });
  }

  /**
   * Add picked files to the project.
   *
   * @param paths - Files.
   */
  protected async addFiles(paths: readonly string[]): Promise<void> {
    await this.files.patchRelations({ paths, projects: { add: [this.name()], remove: [] } });
    this.notify.success(`${String(paths.length)} file(s) added to the project.`);
  }

  /**
   * Link or unlink a person.
   *
   * @param contactId - Contact id.
   * @param linked - Target state.
   */
  protected async setPerson(contactId: string | null, linked: boolean): Promise<void> {
    if (contactId !== null) {
      await this.contacts.setLink(contactId, 'project', this.name(), linked);
    }
  }

  /**
   * Follow a rename.
   *
   * @param name - New name.
   */
  protected onSaved(name: string): void {
    if (name !== this.name()) {
      void this.router.navigate(['/projects', name], { replaceUrl: true });
    }
  }

  /** Confirm and delete the project (its time entries go with it). */
  protected remove(): void {
    this.confirm.confirm({
      header: 'Delete project',
      message: `Delete “${this.name()}”? Its time entries are deleted too (database cascade). Files are kept.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () =>
        void this.projects.delete(this.name()).then(() => this.router.navigate(['/projects'])),
    });
  }

  /**
   * Priority of a task.
   *
   * @param task - Task.
   * @returns Priority.
   */
  protected priority(task: TaskDetail): ReturnType<typeof priorityOf> {
    return priorityOf(task.priority);
  }

  /**
   * Tasks of a project, collected from every board.
   *
   * @param name - Project.
   * @returns Tasks (unique).
   */
  private async projectTasks(name: string): Promise<TaskDetail[]> {
    const boards = await this.work.boards();
    const details = await Promise.all(boards.map((board) => this.work.board(board.id)));
    const tasks = new Map<string, TaskDetail>();
    for (const task of details.flatMap((board) =>
      board.columns.flatMap((column) => column.tasks),
    )) {
      if (task.projects.includes(name)) {
        tasks.set(task.id, task);
      }
    }
    return [...tasks.values()];
  }
}

import { type CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ColorPickerModule } from 'primeng/colorpicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { TASK_PRIORITIES, type KanbanColumn, type TaskDetail } from '@domain/contracts';
import { formatLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { DataSync } from '../../core/state/data-sync.service';
import { WorkApi } from '../../core/work/work.api';
import { ContactAvatarComponent } from '../../shared/ui/contact-avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { RelationChipsComponent } from '../../shared/ui/relation-chips.component';
import { monthWeeks } from '../time/time-model';
import { TaskDialogComponent } from './task-dialog.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view.component';
import {
  blockersOf,
  columnSwaps,
  dueDay,
  matchesFilters,
  priorityOf,
  type TaskFilters,
  timelineGroups,
} from './work-model';

/** Views of a board. */
type WorkView = 'board' | 'calendar' | 'timeline';

/** Column being created or edited. */
interface ColumnDraft {
  readonly id: string | null;
  name: string;
  color: string;
}

const VIEWS = [
  { value: 'board', icon: 'pi pi-th-large', label: 'Board' },
  { value: 'calendar', icon: 'pi pi-calendar', label: 'Calendar' },
  { value: 'timeline', icon: 'pi pi-list', label: 'Timeline' },
];
const DEFAULT_COLUMN_COLOR = '#7700a7';
const CARD_DESCRIPTION_LINES = 8;
const MAX_VISIBLE_COLUMNS = 6;

/** Work: kanban boards with drag and drop, plus calendar and timeline views of due dates. */
@Component({
  selector: 'ac-work-page',
  imports: [
    NgTemplateOutlet,
    DragDropModule,
    FormsModule,
    ButtonModule,
    ColorPickerModule,
    DialogModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    SelectButtonModule,
    ToggleSwitchModule,
    TooltipModule,
    ContactAvatarComponent,
    EmptyStateComponent,
    RelationChipsComponent,
    TaskDialogComponent,
    MarkdownViewComponent,
  ],
  templateUrl: './work.page.html',
  styleUrl: './work.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkPage {
  private readonly work = inject(WorkApi);
  private readonly sync = inject(DataSync);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmationService);
  protected readonly catalog = inject(CatalogStore);

  /** Query parameter: board id. */
  readonly board = input<string | undefined>(undefined);
  /** Query parameter: view. */
  readonly view = input<string | undefined>(undefined);
  /** Query parameter: `1` opens a new task in the first column. */
  readonly newTask = input<string | undefined>(undefined);

  protected readonly views = VIEWS;
  protected readonly descriptionLines = CARD_DESCRIPTION_LINES;
  protected readonly visibleColumns = computed(() =>
    Math.max(1, Math.min(MAX_VISIBLE_COLUMNS, this.columns().length)),
  );
  protected readonly priorities = [...TASK_PRIORITIES];
  protected readonly today = formatLocalDate(new Date());
  protected readonly filters = signal<TaskFilters>({
    projects: [],
    tags: [],
    priorities: [],
    showDone: false,
  });
  protected readonly taskDialog = signal<{
    task: TaskDetail | null;
    columnId: string | null;
  } | null>(null);
  protected readonly boardDialog = signal<{
    id: string | null;
    name: string;
    description: string;
  } | null>(null);
  protected readonly columnDraft = signal<ColumnDraft | null>(null);
  protected readonly calendarMonth = signal(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  protected readonly boards = resource({
    params: () => this.sync.version('kanban')(),
    loader: () => this.work.boards(),
  });
  protected readonly boardId = computed(() => this.board() ?? this.boards.value()?.[0]?.id ?? null);
  protected readonly current = resource({
    params: () => {
      const id = this.boardId();
      return id === null ? undefined : { id, version: this.sync.version('kanban')() };
    },
    loader: ({ params }) => this.work.board(params.id),
  });
  protected readonly tasks = resource({
    params: () => this.sync.version('tasks')() + this.sync.version('kanban')(),
    loader: () => this.work.tasks(),
  });

  protected readonly activeView = computed<WorkView>(() =>
    this.view() === 'calendar' || this.view() === 'timeline' ? (this.view() as WorkView) : 'board',
  );
  protected readonly columns = linkedSignal<readonly KanbanColumn[]>(
    () => this.current.value()?.columns ?? [],
  );
  private readonly tasksById = computed(
    () => new Map((this.tasks.value() ?? []).map((task) => [task.id, task])),
  );
  protected readonly boardTasks = computed(() =>
    this.columns()
      .flatMap((column) => column.tasks)
      .filter((task) => matchesFilters(task, { ...this.filters(), showDone: true })),
  );
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly tagOptions = computed(() => this.catalog.tagList().map((tag) => tag.name));
  protected readonly boardOptions = computed(() => this.boards.value() ?? []);
  protected readonly timeline = computed(() =>
    timelineGroups(
      this.boardTasks().filter((task) => task.completed === null),
      new Date(),
    ),
  );
  protected readonly calendarWeeks = computed(() =>
    monthWeeks(this.calendarMonth().getFullYear(), this.calendarMonth().getMonth(), true),
  );
  protected readonly calendarLabel = computed(() =>
    new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
      this.calendarMonth(),
    ),
  );

  /** Open the dialog requested by the URL (`?newTask=1`) once the board is loaded. */
  constructor() {
    effect(() => {
      const first = this.columns()[0];
      if (this.newTask() === '1' && (first !== undefined || !this.current.isLoading())) {
        untracked(() => {
          this.taskDialog.set({ task: null, columnId: first?.id ?? null });
          this.navigate({ newTask: null });
        });
      }
    });
  }

  /**
   * Visible tasks of a column.
   *
   * @param column - Column.
   * @returns Filtered tasks.
   */
  protected visibleTasks(column: KanbanColumn): readonly TaskDetail[] {
    return column.tasks.filter((task) => matchesFilters(task, this.filters()));
  }

  /**
   * Tasks due on a day (calendar view).
   *
   * @param date - Day.
   * @returns Tasks.
   */
  protected dueOn(date: string): TaskDetail[] {
    return this.boardTasks().filter((task) => dueDay(task) === date);
  }

  /**
   * Priority icon and color.
   *
   * @param task - Task.
   * @returns Priority.
   */
  protected priority(task: TaskDetail): (typeof TASK_PRIORITIES)[number] {
    return priorityOf(task.priority);
  }

  /**
   * Titles of open dependencies.
   *
   * @param task - Task.
   * @returns Titles (empty when not blocked).
   */
  protected blockedBy(task: TaskDetail): string[] {
    return blockersOf(task, this.tasksById()).map((blocker) => blocker.title);
  }

  /**
   * Name of a contact.
   *
   * @param id - Contact id.
   * @returns Name (id when unknown).
   */
  protected contactName(id: string): string {
    return this.catalog.contactList().find((contact) => contact.id === id)?.name ?? id;
  }

  /**
   * Patch the filters.
   *
   * @param patch - Changed filters.
   */
  protected filter(patch: Partial<TaskFilters>): void {
    this.filters.update((filters) => ({ ...filters, ...patch }));
  }

  /**
   * Update the URL (board, view).
   *
   * @param params - Query parameters.
   */
  protected navigate(params: Record<string, string | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }

  /**
   * Move a task to another column (drag and drop).
   *
   * @param event - Drop event.
   */
  protected async dropTask(event: CdkDragDrop<string, string, TaskDetail>): Promise<void> {
    if (event.previousContainer === event.container) {
      return;
    }
    this.columns.update((columns) =>
      this.moveLocally(columns, event.item.data, event.container.data),
    );
    await this.work.moveTask(event.container.data, event.item.data.id);
    this.work.refresh();
  }

  /**
   * Reorder columns (drag and drop): the backend only swaps neighbours.
   *
   * @param event - Drop event.
   */
  protected async dropColumn(
    event: CdkDragDrop<readonly KanbanColumn[], readonly KanbanColumn[], KanbanColumn>,
  ): Promise<void> {
    const swaps = columnSwaps(event.previousIndex, event.currentIndex);
    if (swaps.length === 0) {
      return;
    }
    this.columns.update((columns) => {
      const next = [...columns];
      next.splice(event.currentIndex, 0, ...next.splice(event.previousIndex, 1));
      return next;
    });
    for (const direction of swaps) {
      await this.work.moveColumn(event.item.data.id, direction);
    }
    this.work.refresh();
  }

  /**
   * Toggle completion; finished tasks move to the last column.
   *
   * @param task - Task.
   */
  protected async toggleDone(task: TaskDetail): Promise<void> {
    await this.work.toggleComplete(task.id);
    const last = this.columns().at(-1);
    if (
      task.completed === null &&
      last !== undefined &&
      !last.tasks.some((item) => item.id === task.id)
    ) {
      await this.work.moveTask(last.id, task.id);
      this.work.refresh();
    }
  }

  /** Save the board dialog. */
  protected async saveBoard(): Promise<void> {
    const draft = this.boardDialog();
    if (draft === null || draft.name.trim() === '') {
      return;
    }
    if (draft.id === null) {
      const board = await this.work.createBoard(draft.name.trim(), draft.description);
      this.navigate({ board: board.id });
    } else {
      await this.work.updateBoard(draft.id, draft.name.trim(), draft.description);
    }
    this.boardDialog.set(null);
  }

  /** Confirm and delete the current board. */
  protected deleteBoard(): void {
    const board = this.current.value();
    if (board === undefined) {
      return;
    }
    this.confirm.confirm({
      header: 'Delete board',
      message: `Delete “${board.name}” and its columns? Tasks are kept.`,
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () =>
        void this.work.deleteBoard(board.id).then(() => {
          this.navigate({ board: null });
        }),
    });
  }

  /**
   * Open the column dialog.
   *
   * @param column - Column to edit, or null to add one.
   */
  protected editColumn(column: KanbanColumn | null): void {
    this.columnDraft.set(
      column === null
        ? { id: null, name: '', color: DEFAULT_COLUMN_COLOR }
        : { id: column.id, name: column.name, color: column.color },
    );
  }

  /** Save the column dialog. */
  protected async saveColumn(): Promise<void> {
    const draft = this.columnDraft();
    const boardId = this.boardId();
    if (draft === null || boardId === null || draft.name.trim() === '') {
      return;
    }
    const color = draft.color.startsWith('#') ? draft.color : `#${draft.color}`;
    if (draft.id === null) {
      await this.work.createColumn(boardId, {
        name: draft.name.trim(),
        color,
        position: this.columns().length,
      });
    } else {
      const position = this.columns().find((column) => column.id === draft.id)?.position ?? 0;
      await this.work.updateColumn(draft.id, { name: draft.name.trim(), color, position });
    }
    this.columnDraft.set(null);
  }

  /** Delete the column being edited. */
  protected async deleteColumn(): Promise<void> {
    const draft = this.columnDraft();
    if (draft?.id !== null && draft?.id !== undefined) {
      await this.work.deleteColumn(draft.id);
      this.columnDraft.set(null);
    }
  }

  /**
   * Shift the calendar month.
   *
   * @param delta - Months.
   */
  protected shiftCalendar(delta: number): void {
    const month = this.calendarMonth();
    this.calendarMonth.set(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  }

  /**
   * Move a task between columns in the local copy (optimistic update).
   *
   * @param columns - Columns.
   * @param task - Moved task.
   * @param targetId - Destination column.
   * @returns Updated columns.
   */
  private moveLocally(
    columns: readonly KanbanColumn[],
    task: TaskDetail,
    targetId: string,
  ): KanbanColumn[] {
    return columns.map((column) => {
      const without = column.tasks.filter((item) => item.id !== task.id);
      return { ...column, tasks: column.id === targetId ? [task, ...without] : without };
    });
  }
}

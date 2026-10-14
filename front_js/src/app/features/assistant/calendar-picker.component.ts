import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import type { CalendarRecord } from '@domain/contracts';
import { addDays, formatLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { CalendarApi } from '../../core/time/calendar.api';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';

const DEFAULT_DAYS = 7;

/** Pick time entries to attach to a chat message. */
@Component({
  selector: 'ac-calendar-picker',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    DialogModule,
    InputTextModule,
    SelectModule,
    TagChipComponent,
  ],
  template: `
    <p-dialog
      header="Attach time entries"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(720px, 98vw)' }"
    >
      <div class="filters">
        <p-datepicker
          selectionMode="range"
          [ngModel]="range()"
          (ngModelChange)="setRange($event)"
          dateFormat="yy-mm-dd"
          [showIcon]="true"
          appendTo="body"
          ariaLabel="Date range"
        />
        <input
          pInputText
          placeholder="Title contains…"
          [ngModel]="text()"
          (ngModelChange)="text.set($event)"
          aria-label="Title"
        />
        <p-select
          [options]="projects()"
          [ngModel]="project()"
          (ngModelChange)="project.set($event)"
          [showClear]="true"
          placeholder="Any project"
          appendTo="body"
          ariaLabel="Project"
        />
      </div>
      <div class="list">
        @for (record of records.value() ?? []; track record.id) {
          <label class="row">
            <p-checkbox
              [binary]="true"
              [ngModel]="selected().has(record.id)"
              (ngModelChange)="toggle(record.id)"
            />
            <span class="date ac-muted">{{ record.date }}</span>
            <strong class="grow">{{ record.title }}</strong>
            <ac-tag-chip [name]="record.project" kind="project" />
            <span>{{ record.hours }}h</span>
          </label>
        } @empty {
          <p class="ac-muted">{{ records.isLoading() ? 'Loading…' : 'No entries.' }}</p>
        }
      </div>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          [label]="'Attach ' + selected().size"
          icon="pi pi-check"
          [disabled]="selected().size === 0"
          (onClick)="confirm()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .list {
      max-height: 50vh;
      overflow: auto;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
      border-bottom: 1px solid var(--ac-panel-border);
      cursor: pointer;
    }
    .date {
      width: 90px;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPickerComponent {
  private readonly calendar = inject(CalendarApi);
  private readonly catalog = inject(CatalogStore);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Emits the chosen records. */
  readonly picked = output<CalendarRecord[]>();

  protected readonly range = signal<Date[]>([addDays(new Date(), -DEFAULT_DAYS), new Date()]);
  protected readonly text = signal('');
  protected readonly project = signal<string | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly projects = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );

  protected readonly records = resource({
    params: () => {
      const [start, end] = this.range();
      return this.visible() && start !== undefined
        ? {
            start: formatLocalDate(start),
            end: formatLocalDate(end ?? start),
            text: this.text(),
            project: this.project(),
          }
        : undefined;
    },
    loader: ({ params }) =>
      this.calendar.search({
        start: params.start,
        end: params.end,
        text: params.text || null,
        project: params.project,
      }),
  });

  /**
   * Apply the date range.
   *
   * @param dates - Picked dates.
   */
  protected setRange(dates: (Date | null)[] | null): void {
    const valid = (dates ?? []).filter((date): date is Date => date !== null);
    if (valid.length > 0) {
      this.range.set(valid);
    }
  }

  /**
   * Toggle a record.
   *
   * @param id - Record id.
   */
  protected toggle(id: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** Emit the selection and close. */
  protected confirm(): void {
    this.picked.emit(
      (this.records.value() ?? []).filter((record) => this.selected().has(record.id)),
    );
    this.selected.set(new Set());
    this.visible.set(false);
  }
}

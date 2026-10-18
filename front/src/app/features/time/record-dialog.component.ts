import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import type { CalendarRecord, CalendarRecordInput } from '@domain/contracts';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import { CatalogStore } from '../../core/catalog/catalog.store';
import { NotifyService } from '../../core/notify/notify.service';
import { CalendarApi } from '../../core/time/calendar.api';
import { AiTextareaComponent } from '../../shared/ui/ai-textarea.component';
import { TagChipComponent } from '../../shared/ui/tag-chip.component';

/** Editable form state. */
interface RecordForm {
  title: string;
  project: string | null;
  date: Date;
  start: Date | null;
  hours: number;
  description: string;
  location: string;
  attendees: string;
  contacts: string[];
}

const DEFAULT_HOURS = 1;
const PAD = 2;

/**
 * Format a time as `HH:MM`.
 *
 * @param date - Date holding the time.
 * @returns Time.
 */
function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(PAD, '0')}:${String(date.getMinutes()).padStart(PAD, '0')}`;
}

/**
 * Parse `HH:MM` on a given day.
 *
 * @param day - Day.
 * @param time - Time or null.
 * @returns Date, or null.
 */
function atTime(day: Date, time: string | null): Date | null {
  if (time === null) {
    return null;
  }
  const [hours, minutes] = time.split(':').map(Number);
  const value = new Date(day);
  value.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return value;
}

/** Create or edit a time entry. */
@Component({
  selector: 'ac-record-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    MultiSelectModule,
    SelectModule,
    AiTextareaComponent,
    TagChipComponent,
  ],
  templateUrl: './record-dialog.component.html',
  styleUrl: './record-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordDialogComponent {
  private readonly calendar = inject(CalendarApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);
  protected readonly catalog = inject(CatalogStore);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Record to edit (`null` creates). */
  readonly record = input<CalendarRecord | null>(null);
  /** Date preselected when creating. */
  readonly defaultDate = input<string | null>(null);
  /** Project preselected when creating. */
  readonly defaultProject = input<string | null>(null);

  protected readonly form = signal<RecordForm>(this.emptyForm());
  protected readonly saving = signal(false);
  protected readonly projectOptions = computed(() =>
    this.catalog.projectList().map((project) => project.name),
  );
  protected readonly contactOptions = computed(() =>
    this.catalog.contactList().map((contact) => ({ label: contact.name, value: contact.id })),
  );
  protected readonly dateChanged = computed(() => {
    const record = this.record();
    return record !== null && formatLocalDate(this.form().date) !== record.date;
  });

  /** Reset the form when the dialog opens. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.form.set(this.initialForm());
        });
      }
    });
  }

  /**
   * Patch the form.
   *
   * @param patch - Changed fields.
   */
  protected patch(patch: Partial<RecordForm>): void {
    this.form.update((form) => ({ ...form, ...patch }));
  }

  /** Save (create, edit, or re-create on another date). */
  protected async save(): Promise<void> {
    const input = this.toInput();
    if (input === null) {
      this.notify.warn('Title and project are required.');
      return;
    }
    this.saving.set(true);
    try {
      await this.persist(input);
      this.notify.success('Time entry saved.');
      this.visible.set(false);
    } finally {
      this.saving.set(false);
    }
  }

  /** Confirm and delete. */
  protected remove(): void {
    const record = this.record();
    if (record === null) {
      return;
    }
    this.confirm.confirm({
      header: 'Delete time entry',
      message: `Delete “${record.title}”?`,
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () =>
        void this.calendar.delete(record.id).then(() => {
          this.visible.set(false);
        }),
    });
  }

  /**
   * Write the record.
   *
   * @param input - Record input.
   */
  private async persist(input: CalendarRecordInput): Promise<void> {
    const record = this.record();
    if (record === null) {
      await this.calendar.create(input);
      return;
    }
    if (this.dateChanged()) {
      await this.calendar.create(input);
      await this.calendar.delete(record.id);
      return;
    }
    await this.calendar.update(record.id, input);
  }

  /**
   * Build the API input from the form.
   *
   * @returns Input, or `null` when invalid.
   */
  private toInput(): CalendarRecordInput | null {
    const form = this.form();
    if (form.title.trim() === '' || form.project === null) {
      return null;
    }
    return {
      title: form.title.trim(),
      project: form.project,
      date: formatLocalDate(form.date),
      startTime: form.start === null ? null : hhmm(form.start),
      hours: form.hours,
      description: form.description,
      location: form.location,
      attendees: form.attendees,
      contacts: form.contacts,
    };
  }

  /**
   * Form for the current record or a new one.
   *
   * @returns Form.
   */
  private initialForm(): RecordForm {
    const record = this.record();
    if (record === null) {
      return this.emptyForm();
    }
    const day = parseLocalDate(record.date) ?? new Date();
    return {
      title: record.title,
      project: record.project,
      date: day,
      start: atTime(day, record.startTime),
      hours: record.hours,
      description: record.description,
      location: record.location,
      attendees: record.attendees,
      contacts: record.contacts.map((contact) => contact.id),
    };
  }

  /**
   * Blank form with the defaults.
   *
   * @returns Form.
   */
  private emptyForm(): RecordForm {
    const day = parseLocalDate(this.defaultDate() ?? '') ?? new Date();
    return {
      title: '',
      project: this.defaultProject(),
      date: day,
      start: null,
      hours: DEFAULT_HOURS,
      description: '',
      location: '',
      attendees: '',
      contacts: [],
    };
  }
}

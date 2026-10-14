import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import type { ContactDetail, ContactUpsert } from '@domain/contracts';
import { NotifyService } from '../../core/notify/notify.service';
import { ContactsApi } from '../../core/people/contacts.api';
import { AiTextareaComponent } from '../../shared/ui/ai-textarea.component';

/** Editable contact fields. */
interface ContactForm {
  name: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  description: string;
}

const FIELDS: readonly {
  readonly key: Exclude<keyof ContactForm, 'description'>;
  readonly label: string;
  readonly type: string;
}[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'role', label: 'Role', type: 'text' },
];

/** Fields read from an existing contact (blank when creating). */
const BLANK: Omit<ContactDetail, 'id'> = {
  name: '',
  email: null,
  phone: null,
  company: null,
  role: null,
  description: null,
  notes: '',
  projects: [],
  tags: [],
  files: [],
};

/**
 * Form state of a contact.
 *
 * @param contact - Contact or null.
 * @returns Form.
 */
function formOf(contact: ContactDetail | null): ContactForm {
  const source = contact ?? BLANK;
  return {
    name: source.name,
    email: source.email ?? '',
    phone: source.phone ?? '',
    company: source.company ?? '',
    role: source.role ?? '',
    description: source.description ?? '',
  };
}

/**
 * Empty strings become `null` (the backend stores optional fields as NULL).
 *
 * @param value - Field value.
 * @returns Trimmed value or null.
 */
function optional(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/** Create or edit a contact (links and notes are kept on edit: PUT replaces everything). */
@Component({
  selector: 'ac-contact-dialog',
  imports: [FormsModule, ButtonModule, DialogModule, InputTextModule, AiTextareaComponent],
  template: `
    <p-dialog
      [header]="contact() ? 'Edit contact' : 'New contact'"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(560px, 96vw)' }"
    >
      <form class="grid" (ngSubmit)="save()">
        @for (field of fields; track field.key) {
          <label class="field" [class.wide]="field.key === 'name'">
            <span>{{ field.label }}</span>
            <input
              pInputText
              [type]="field.type"
              [name]="field.key"
              [ngModel]="form()[field.key]"
              (ngModelChange)="patch(field.key, $event)"
            />
          </label>
        }
        <div class="field wide">
          <span>Description</span>
          <ac-ai-textarea
            [value]="form().description"
            (valueChange)="patch('description', $event)"
            [rows]="3"
            context="This describes a professional contact."
          />
        </div>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button label="Save" icon="pi pi-check" [loading]="saving()" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--ac-muted);
    }
    .wide {
      grid-column: 1 / -1;
    }
    input {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactDialogComponent {
  private readonly contacts = inject(ContactsApi);
  private readonly notify = inject(NotifyService);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Contact to edit (`null` creates). */
  readonly contact = input<ContactDetail | null>(null);
  /** Emits the id of the saved contact. */
  readonly saved = output<string>();

  protected readonly fields = FIELDS;
  protected readonly form = signal<ContactForm>({
    name: '',
    email: '',
    phone: '',
    company: '',
    role: '',
    description: '',
  });
  protected readonly saving = signal(false);

  /** Load the contact when the dialog opens. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.form.set(formOf(this.contact()));
        });
      }
    });
  }

  /**
   * Change one field.
   *
   * @param key - Field.
   * @param value - Value.
   */
  protected patch(key: keyof ContactForm, value: string): void {
    this.form.update((form) => ({ ...form, [key]: value }));
  }

  /** Save. */
  protected async save(): Promise<void> {
    const form = this.form();
    if (form.name.trim() === '') {
      this.notify.warn('A name is required.');
      return;
    }
    this.saving.set(true);
    try {
      const contact = this.contact();
      const kept = contact ?? BLANK;
      const body: ContactUpsert = {
        name: form.name.trim(),
        email: optional(form.email),
        phone: optional(form.phone),
        company: optional(form.company),
        role: optional(form.role),
        description: optional(form.description),
        notes: kept.notes ?? '',
        projects: kept.projects,
        tags: kept.tags,
        files: kept.files,
      };
      let id = contact?.id ?? '';
      if (contact === null) {
        id = await this.contacts.create(body);
      } else {
        await this.contacts.update(contact.id, body);
      }
      this.saved.emit(id);
      this.visible.set(false);
    } finally {
      this.saving.set(false);
    }
  }
}

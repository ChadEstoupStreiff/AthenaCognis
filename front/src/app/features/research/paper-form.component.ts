import { ChangeDetectionStrategy, Component, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import type { InfoTextField, PaperInfo } from '@domain/sota';

/** Grid span of a field (out of 4 columns). */
type FieldSpan = 'wide' | 'span3' | 'span2' | 'span1';

/** One editable reference field. */
interface FormField {
  readonly key: InfoTextField;
  readonly label: string;
  readonly hint?: string;
  readonly span: FieldSpan;
}

const FIELDS: readonly FormField[] = [
  { key: 'title', label: 'Title', span: 'wide' },
  {
    key: 'authors',
    label: 'Authors',
    hint: 'separate with |, e.g. Doe, John | Smith, Ann',
    span: 'wide',
  },
  { key: 'year', label: 'Year', span: 'span1' },
  { key: 'journal', label: 'Journal', span: 'span3' },
  { key: 'volume', label: 'Volume', span: 'span1' },
  { key: 'issue', label: 'Issue', span: 'span1' },
  { key: 'pages', label: 'Pages', span: 'span2' },
  { key: 'doi', label: 'DOI', span: 'span2' },
  { key: 'url', label: 'URL', span: 'span2' },
];

/** Reference fields of one paper (two-way bound draft). */
@Component({
  selector: 'ac-paper-form',
  imports: [FormsModule, InputTextModule],
  template: `
    <form class="form" (ngSubmit)="submitted.emit()">
      @for (field of fields; track field.key) {
        <label class="field" [class]="field.span">
          <span
            >{{ field.label }}
            @if (field.hint) {
              <small>{{ field.hint }}</small>
            }
          </span>
          <input
            pInputText
            [name]="field.key"
            [ngModel]="info()[field.key]"
            (ngModelChange)="set(field.key, $event)"
          />
        </label>
      }
      <button type="submit" hidden></button>
    </form>
  `,
  styleUrl: './paper-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperFormComponent {
  /** Draft reference. */
  readonly info = model.required<PaperInfo>();
  /** Enter pressed in a field. */
  readonly submitted = output();

  protected readonly fields = FIELDS;

  /**
   * Change one field.
   *
   * @param field - Field.
   * @param value - Value.
   */
  protected set(field: InfoTextField, value: string): void {
    this.info.update((draft) => ({ ...draft, [field]: value }));
  }
}

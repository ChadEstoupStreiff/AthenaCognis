import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectButtonModule } from 'primeng/selectbutton';
import {
  CARD_FIELDS,
  type CardField,
  DEFAULT_CARD_INLINE,
  DEFAULT_VISIBLE_COLUMNS,
  MAX_VISIBLE_COLUMNS,
  MIN_VISIBLE_COLUMNS,
} from '../../work/work-model';
import { SettingsSection } from './settings-section';

/** Where a relation is rendered in full. */
type CardMode = 'card' | 'details';

const COLUMNS_KEY = 'work_max_visible_columns';
const INLINE_KEY = 'work_card_inline';
const FIELD_LABELS: Readonly<Record<CardField, string>> = {
  projects: 'Projects',
  tags: 'Tags',
  people: 'People',
  files: 'Files',
};
const MODE_OPTIONS = [
  { value: 'card', label: 'On card' },
  { value: 'details', label: 'In details' },
];

/** Work page: board width and what task cards show. */
@Component({
  selector: 'ac-work-section',
  imports: [FormsModule, InputNumberModule, SelectButtonModule],
  template: `
    <section class="group" id="work">
      <h2>Work</h2>
      <div class="row">
        <div class="label">
          <strong>Visible columns</strong
          ><small class="ac-muted">Columns sharing the board width. More columns scroll.</small>
        </div>
        <p-inputnumber
          [ngModel]="num(columnsKey, defaultColumns)"
          (ngModelChange)="save(columnsKey, $event ?? defaultColumns)"
          [min]="minColumns"
          [max]="maxColumns"
          [showButtons]="true"
          ariaLabel="Visible columns"
        />
      </div>

      <h3 class="subhead" id="work-cards">Task cards</h3>
      <p class="intro ac-muted">
        On card: full list, clickable from the board. In details: count on the card, clickable list
        when the task opens.
      </p>
      @for (field of fields; track field) {
        <div class="row">
          <div class="label">
            <strong>{{ labels[field] }}</strong>
          </div>
          <p-selectbutton
            [options]="modes"
            optionValue="value"
            [allowEmpty]="false"
            [ngModel]="mode(field)"
            (ngModelChange)="setMode(field, $event)"
            size="small"
            [ariaLabel]="labels[field]"
          />
        </div>
      }
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkSectionComponent extends SettingsSection {
  protected readonly columnsKey = COLUMNS_KEY;
  protected readonly defaultColumns = DEFAULT_VISIBLE_COLUMNS;
  protected readonly minColumns = MIN_VISIBLE_COLUMNS;
  protected readonly maxColumns = MAX_VISIBLE_COLUMNS;
  protected readonly fields = CARD_FIELDS;
  protected readonly labels = FIELD_LABELS;
  protected readonly modes = MODE_OPTIONS;

  /**
   * Where a relation is rendered.
   *
   * @param field - Relation.
   * @returns Mode.
   */
  protected mode(field: CardField): CardMode {
    return this.inlineFields().includes(field) ? 'card' : 'details';
  }

  /**
   * Store where a relation is rendered.
   *
   * @param field - Relation.
   * @param mode - New mode.
   */
  protected setMode(field: CardField, mode: CardMode): void {
    const current = this.inlineFields();
    const next = CARD_FIELDS.filter((item) =>
      item === field ? mode === 'card' : current.includes(item),
    );
    this.save(INLINE_KEY, next, true);
  }

  /**
   * Relations currently rendered on cards.
   *
   * @returns Stored list (defaults when unset).
   */
  private inlineFields(): readonly string[] {
    return this.stableList(INLINE_KEY, DEFAULT_CARD_INLINE);
  }
}

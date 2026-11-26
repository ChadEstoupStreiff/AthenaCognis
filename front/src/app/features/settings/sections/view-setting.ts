import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SettingsSection } from './settings-section';

const VIEW_OPTIONS = [
  { value: 0, label: 'Cards' },
  { value: 1, label: 'List' },
  { value: 2, label: 'Table' },
];
const DEFAULT_VIEW = 1;

/** One settings row picking the default file view (cards, list, table) of a page. */
@Component({
  selector: 'ac-view-setting',
  imports: [FormsModule, SelectButtonModule],
  template: `
    <div class="label">
      <strong>{{ label() }}</strong>
    </div>
    <p-selectbutton
      [options]="views"
      optionValue="value"
      [allowEmpty]="false"
      [ngModel]="num(key(), defaultView)"
      (ngModelChange)="save(key(), $event, true)"
      size="small"
      [ariaLabel]="label()"
    />
  `,
  host: { class: 'row' },
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewSettingComponent extends SettingsSection {
  /** Setting key. */
  readonly key = input.required<string>();
  /** Row label. */
  readonly label = input.required<string>();

  protected readonly views = VIEW_OPTIONS;
  protected readonly defaultView = DEFAULT_VIEW;
}

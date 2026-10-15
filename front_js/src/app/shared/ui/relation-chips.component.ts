import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TagChipComponent } from './tag-chip.component';

/** Project chips on one row, tag chips on the row below. */
@Component({
  selector: 'ac-relation-chips',
  imports: [TagChipComponent],
  template: `
    @if (projects().length > 0) {
      <div class="row">
        @for (project of projects(); track project) {
          <ac-tag-chip [name]="project" kind="project" />
        }
      </div>
    }
    @if (tags().length > 0) {
      <div class="row">
        @for (tag of tags(); track tag) {
          <ac-tag-chip [name]="tag" />
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationChipsComponent {
  /** Project names (first row). */
  readonly projects = input<readonly string[]>([]);
  /** Tag names (second row). */
  readonly tags = input<readonly string[]>([]);
}

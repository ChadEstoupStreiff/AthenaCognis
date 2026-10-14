import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Page title row with an optional subtitle and projected actions. */
@Component({
  selector: 'ac-page-header',
  template: `
    <header class="header">
      <div class="titles">
        <h1>{{ title() }}</h1>
        @if (subtitle(); as text) {
          <p class="ac-muted">{{ text }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      letter-spacing: -0.02em;
    }
    p {
      margin: 4px 0 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeaderComponent {
  /** Page title. */
  readonly title = input.required<string>();
  /** Optional subtitle. */
  readonly subtitle = input<string | null>(null);
}

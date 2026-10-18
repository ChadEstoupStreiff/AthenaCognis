import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Centered icon + message used when a list or page has nothing to show. */
@Component({
  selector: 'ac-empty-state',
  template: `
    <div class="empty">
      <i [class]="icon()" aria-hidden="true"></i>
      <h2>{{ title() }}</h2>
      @if (message(); as text) {
        <p class="ac-muted">{{ text }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 48px 16px;
      text-align: center;
    }
    i {
      font-size: 2rem;
      color: var(--p-primary-color);
      opacity: 0.8;
    }
    h2 {
      margin: 4px 0 0;
      font-size: 16px;
    }
    p {
      margin: 0;
      max-width: 420px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  /** PrimeIcons class. */
  readonly icon = input('pi pi-inbox');
  /** Headline. */
  readonly title = input.required<string>();
  /** Optional explanation. */
  readonly message = input<string | null>(null);
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import type { FileContact } from '@domain/contracts';
import { ContactAvatarComponent } from './contact-avatar.component';

const DEFAULT_MAX_SHOWN = 4;
const DEFAULT_SIZE = 22;

/** Overlapping heads of the people linked to something, with a "+N" overflow and names on hover. */
@Component({
  selector: 'ac-people-stack',
  imports: [TooltipModule, ContactAvatarComponent],
  template: `
    @if (people().length > 0) {
      <span
        class="stack"
        [pTooltip]="names()"
        tooltipPosition="top"
        [attr.aria-label]="'People: ' + names()"
        role="img"
      >
        @for (person of shown(); track person.id) {
          <ac-contact-avatar
            class="head"
            [contactId]="person.id"
            [name]="person.name"
            [size]="size()"
          />
        }
        @if (overflow() > 0) {
          <span
            class="head more"
            [style.width.px]="size()"
            [style.height.px]="size()"
            [style.font-size.px]="size() * 0.42"
            >+{{ overflow() }}</span
          >
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .stack {
      display: inline-flex;
      align-items: center;
    }
    .head {
      display: inline-flex;
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--ac-panel-background);
    }
    .head + .head {
      margin-left: -6px;
    }
    .more {
      align-items: center;
      justify-content: center;
      background: var(--p-content-hover-background);
      color: var(--ac-muted);
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeopleStackComponent {
  /** People to draw. */
  readonly people = input<readonly FileContact[]>([]);
  /** Heads drawn before the "+N" bubble. */
  readonly maxShown = input(DEFAULT_MAX_SHOWN);
  /** Head diameter in pixels. */
  readonly size = input(DEFAULT_SIZE);

  protected readonly shown = computed(() => this.people().slice(0, this.maxShown()));
  protected readonly overflow = computed(() => this.people().length - this.shown().length);
  protected readonly names = computed(() =>
    this.people()
      .map((person) => person.name)
      .join(', '),
  );
}

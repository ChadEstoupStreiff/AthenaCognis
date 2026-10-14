import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { readableTextColor } from '@domain/color';
import { CatalogStore } from '../../core/catalog/catalog.store';

/** Colored chip for a tag or project. */
@Component({
  selector: 'ac-tag-chip',
  template: `
    <span
      class="chip"
      [class.project]="kind() === 'project'"
      [style.--chip-color]="color()"
      [style.--chip-text]="textColor()"
    >
      @if (kind() === 'project') {
        <span class="dot"></span>
      }
      <span class="name">{{ name() }}</span>
      @if (removable()) {
        <button
          type="button"
          class="remove"
          [attr.aria-label]="'Remove ' + name()"
          (click)="removed.emit(name())"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      }
    </span>
  `,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 20px;
      background: var(--chip-color);
      color: var(--chip-text);
      white-space: nowrap;
    }
    .chip.project {
      background: color-mix(in srgb, var(--chip-color) 14%, transparent);
      color: var(--p-text-color);
      border: 1px solid color-mix(in srgb, var(--chip-color) 40%, transparent);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--chip-color);
      flex: none;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .remove {
      display: inline-flex;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      cursor: pointer;
      font-size: 10px;
      opacity: 0.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagChipComponent {
  private readonly catalog = inject(CatalogStore);

  /** Tag or project name. */
  readonly name = input.required<string>();
  /** Chip style. */
  readonly kind = input<'tag' | 'project'>('tag');
  /** Show a remove button. */
  readonly removable = input(false);
  /** Emits the name when removed. */
  readonly removed = output<string>();

  protected readonly color = computed(() =>
    this.kind() === 'project'
      ? this.catalog.projectColor(this.name())
      : this.catalog.tagColor(this.name()),
  );
  protected readonly textColor = computed(() => readableTextColor(this.color()));
}

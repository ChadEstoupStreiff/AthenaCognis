import { type CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import type { TodoItem } from '@domain/contracts';

/** Editable checklist (drag to reorder, done items sink to the bottom). */
@Component({
  selector: 'ac-todo-list',
  imports: [DragDropModule, FormsModule, ButtonModule, CheckboxModule, InputTextModule],
  template: `
    <form class="add" (ngSubmit)="add()">
      <input
        pInputText
        name="task"
        placeholder="Add a task and press Enter"
        [ngModel]="draft()"
        (ngModelChange)="draft.set($event)"
        aria-label="New TODO item"
      />
    </form>
    <ul class="items" cdkDropList (cdkDropListDropped)="reorder($event)">
      @for (item of items(); track $index; let index = $index) {
        <li class="item" cdkDrag [class.done]="item.done">
          <i class="pi pi-bars handle" cdkDragHandle aria-hidden="true"></i>
          <p-checkbox
            [binary]="true"
            [ngModel]="item.done"
            (ngModelChange)="update(index, { done: $event })"
            [ariaLabel]="'Done: ' + item.task"
          />
          <input
            class="text"
            [ngModel]="item.task"
            (ngModelChange)="update(index, { task: $event })"
            [attr.aria-label]="'TODO ' + (index + 1)"
          />
          <p-button
            icon="pi pi-times"
            [text]="true"
            size="small"
            severity="secondary"
            ariaLabel="Remove"
            (onClick)="remove(index)"
          />
        </li>
      } @empty {
        <li class="empty ac-muted">Nothing to do.</li>
      }
    </ul>
  `,
  styles: `
    .add input {
      width: 100%;
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 8px;
      background: var(--ac-panel-background);
    }
    .item:hover {
      background: var(--p-content-hover-background);
    }
    .handle {
      color: var(--ac-muted);
      cursor: grab;
      font-size: 12px;
    }
    .text {
      flex: 1;
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      outline: none;
    }
    .done .text {
      text-decoration: line-through;
      color: var(--ac-muted);
    }
    .empty {
      padding: 8px;
      font-size: 13px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodoListComponent {
  /** Items. */
  readonly items = input.required<readonly TodoItem[]>();
  /** Emits the new list after every edit. */
  readonly changed = output<TodoItem[]>();

  protected readonly draft = signal('');

  /** Add the draft item at the top of the open items. */
  protected add(): void {
    const task = this.draft().trim();
    if (task !== '') {
      this.emit([{ done: false, task }, ...this.items()]);
      this.draft.set('');
    }
  }

  /**
   * Edit one item.
   *
   * @param index - Position.
   * @param patch - Changed fields.
   */
  protected update(index: number, patch: Partial<TodoItem>): void {
    this.emit(
      this.items().map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  }

  /**
   * Remove one item.
   *
   * @param index - Position.
   */
  protected remove(index: number): void {
    this.emit(this.items().filter((_, position) => position !== index));
  }

  /**
   * Reorder by drag and drop.
   *
   * @param event - Drop event.
   */
  protected reorder(event: CdkDragDrop<unknown>): void {
    const next = [...this.items()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.emit(next);
  }

  /**
   * Emit with done items last (stable order otherwise).
   *
   * @param items - New items.
   */
  private emit(items: readonly TodoItem[]): void {
    this.changed.emit([
      ...items.filter((item) => !item.done),
      ...items.filter((item) => item.done),
    ]);
  }
}

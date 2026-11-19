import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { FolderEntry } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { ChipModule } from 'primeng/chip';
import { DialogModule } from 'primeng/dialog';
import { ActivityApi } from '../../core/activity/activity.api';
import { folderCrumbs, togglePath } from './folder-path';

/** Name shown for the source root. */
const ROOT_LABEL = 'LOCAL_PATH';

/** Picked folders as chips, plus a dialog to walk the source folders and pick some. */
@Component({
  selector: 'ac-folder-picker',
  imports: [FormsModule, ButtonModule, CheckboxModule, ChipModule, DialogModule],
  template: `
    <div class="picked">
      @for (path of picked(); track path) {
        <p-chip [label]="path || rootLabel" [removable]="true" (onRemove)="toggle(path, false)" />
      }
      <p-button
        icon="pi pi-folder-open"
        label="Browse"
        size="small"
        [outlined]="true"
        (onClick)="open()"
        [ariaLabel]="'Browse ' + label()"
      />
    </div>
    <p-dialog
      header="Pick folders"
      [modal]="true"
      [visible]="isOpen()"
      (visibleChange)="isOpen.set($event)"
      [style]="{ width: 'min(560px, 96vw)' }"
    >
      <nav class="crumbs" aria-label="Folder path">
        <button type="button" (click)="go('')">{{ rootLabel }}</button>
        @for (crumb of crumbs(); track crumb.path) {
          <span aria-hidden="true">/</span>
          <button type="button" (click)="go(crumb.path)">{{ crumb.name }}</button>
        }
      </nav>
      <label class="entry current">
        <p-checkbox
          [binary]="true"
          [ngModel]="isPicked(current())"
          (ngModelChange)="toggle(current(), $event)"
        />
        <span>Watch this folder</span>
      </label>
      @if (loading()) {
        <p class="ac-muted">Loading…</p>
      } @else {
        <ul class="entries">
          @for (entry of entries(); track entry.path) {
            <li class="entry">
              <p-checkbox
                [binary]="true"
                [ngModel]="isPicked(entry.path)"
                (ngModelChange)="toggle(entry.path, $event)"
                [ariaLabel]="'Watch ' + entry.name"
              />
              <button
                type="button"
                class="name"
                [disabled]="!entry.has_children"
                (click)="go(entry.path)"
              >
                <i class="pi pi-folder" aria-hidden="true"></i>
                <span>{{ entry.name }}</span>
                @if (entry.has_children) {
                  <i class="pi pi-chevron-right" aria-hidden="true"></i>
                }
              </button>
            </li>
          } @empty {
            <li class="ac-muted">No subfolder</li>
          }
        </ul>
      }
      <ng-template #footer>
        <p-button label="Done" (onClick)="isOpen.set(false)" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .picked {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .crumbs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin-bottom: 8px;
    }
    .crumbs button,
    .name {
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 6px;
    }
    .crumbs button:hover,
    .name:not(:disabled):hover {
      background: var(--p-content-hover-background);
    }
    .name:disabled {
      cursor: default;
    }
    .entries {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 50vh;
      overflow-y: auto;
    }
    .entry {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
    }
    .entry.current {
      padding-bottom: 8px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--ac-panel-border);
    }
    .name {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 8px;
      min-width: 0;
      text-align: left;
    }
    .name span {
      flex: 1;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderPickerComponent {
  private readonly api = inject(ActivityApi);

  /** Key of the source whose folders are browsed. */
  readonly sourceKey = input.required<string>();
  /** Field label, for accessibility. */
  readonly label = input.required<string>();
  /** Picked folders (paths relative to the source root). */
  readonly picked = input.required<readonly string[]>();
  /** Emitted with the new picked list on every change. */
  readonly pickedChange = output<string[]>();

  protected readonly rootLabel = ROOT_LABEL;
  protected readonly isOpen = signal(false);
  protected readonly current = signal('');
  protected readonly entries = signal<readonly FolderEntry[]>([]);
  protected readonly loading = signal(false);
  protected readonly crumbs = computed(() => folderCrumbs(this.current()));

  /** Path of the latest listing asked: answers for older ones are dropped. */
  private requested = '';

  /** Open the dialog at the root. */
  protected open(): void {
    this.isOpen.set(true);
    void this.go('');
  }

  /**
   * Show the subfolders of a folder.
   *
   * @param path - Folder relative to the root.
   */
  protected async go(path: string): Promise<void> {
    this.requested = path;
    this.current.set(path);
    this.loading.set(true);
    try {
      const entries = await this.api.folders(this.sourceKey(), path);
      if (this.requested === path) {
        this.entries.set(entries);
      }
    } catch {
      // The API client already shows the error.
      if (this.requested === path) {
        this.entries.set([]);
      }
    } finally {
      if (this.requested === path) {
        this.loading.set(false);
      }
    }
  }

  /**
   * Tell whether a folder is picked.
   *
   * @param path - Folder relative to the root.
   * @returns True when picked.
   */
  protected isPicked(path: string): boolean {
    return this.picked().includes(path);
  }

  /**
   * Pick or unpick a folder.
   *
   * @param path - Folder relative to the root.
   * @param isPicked - New state.
   */
  protected toggle(path: string, isPicked: boolean): void {
    this.pickedChange.emit(togglePath(this.picked(), path, isPicked));
  }
}

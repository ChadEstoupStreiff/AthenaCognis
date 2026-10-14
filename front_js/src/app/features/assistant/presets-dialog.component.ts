import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  model,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import type { ChatPreset } from '@domain/contracts';
import { parsePresets, serializePresets } from '@domain/mappers';
import { NotifyService } from '../../core/notify/notify.service';
import { SettingsStore } from '../../core/settings/settings.store';

/** Manage chat message presets (setting `chat_presets`, shared with the Streamlit front). */
@Component({
  selector: 'ac-presets-dialog',
  imports: [FormsModule, ButtonModule, DialogModule, InputTextModule, TextareaModule],
  template: `
    <p-dialog
      header="Message presets"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(720px, 98vw)' }"
    >
      <div class="list">
        @for (preset of presets(); track $index; let index = $index) {
          <div class="preset">
            <input
              pInputText
              [ngModel]="preset.title"
              (ngModelChange)="update(index, { title: $event })"
              aria-label="Preset title"
            />
            <textarea
              pTextarea
              [rows]="3"
              [ngModel]="preset.message"
              (ngModelChange)="update(index, { message: $event })"
              aria-label="Preset message"
            ></textarea>
            <p-button
              icon="pi pi-trash"
              [text]="true"
              severity="danger"
              size="small"
              ariaLabel="Delete preset"
              (onClick)="remove(index)"
            />
          </div>
        } @empty {
          <p class="ac-muted">No presets yet.</p>
        }
      </div>
      <p-button label="Add preset" icon="pi pi-plus" size="small" [text]="true" (onClick)="add()" />
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button label="Save" icon="pi pi-check" [loading]="saving()" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 60vh;
      overflow: auto;
      margin-bottom: 8px;
    }
    .preset {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--ac-panel-border);
    }
    .preset input {
      grid-column: 1;
    }
    .preset textarea {
      grid-column: 1;
      width: 100%;
    }
    .preset p-button {
      grid-column: 2;
      grid-row: 1 / span 2;
      align-self: start;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetsDialogComponent {
  private readonly settings = inject(SettingsStore);
  private readonly notify = inject(NotifyService);

  /** Visibility (two-way). */
  readonly visible = model(false);

  protected readonly presets = signal<readonly ChatPreset[]>([]);
  protected readonly saving = signal(false);

  /** Load presets when opened. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.presets.set(parsePresets(this.settings.values()['chat_presets']));
        });
      }
    });
  }

  /**
   * Edit one preset.
   *
   * @param index - Position.
   * @param patch - Changed fields.
   */
  protected update(index: number, patch: Partial<ChatPreset>): void {
    this.presets.update((list) =>
      list.map((preset, position) => (position === index ? { ...preset, ...patch } : preset)),
    );
  }

  /** Add an empty preset. */
  protected add(): void {
    this.presets.update((list) => [...list, { title: 'New preset', message: '' }]);
  }

  /**
   * Remove a preset.
   *
   * @param index - Position.
   */
  protected remove(index: number): void {
    this.presets.update((list) => list.filter((_, position) => position !== index));
  }

  /** Save to settings. */
  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      const valid = this.presets().filter(
        (preset) => preset.title.trim() !== '' && preset.message.trim() !== '',
      );
      await this.settings.set('chat_presets', serializePresets(valid));
      this.notify.success('Presets saved.');
      this.visible.set(false);
    } finally {
      this.saving.set(false);
    }
  }
}

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
import type { DataSourceInfo } from '@domain/contracts';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ActivityApi } from '../../core/activity/activity.api';
import { SettingsSection } from '../settings/sections/settings-section';
import { SettingsWriter } from '../settings/settings-writer';
import { SourceConfigComponent } from './source-config.component';

/** Same cap as the backend (MAX_INSTRUCTION_CHARS). */
const MAX_INSTRUCTION_CHARS = 2000;

/** Configuration of one added data source: on/off, remove, source settings, AI instruction. */
@Component({
  selector: 'ac-source-panel',
  imports: [FormsModule, ButtonModule, TextareaModule, ToggleSwitchModule, SourceConfigComponent],
  providers: [SettingsWriter],
  template: `
    <section class="group" [attr.aria-label]="source().label + ' settings'">
      <div class="heading">
        <h2><i [class]="source().icon" aria-hidden="true"></i> {{ source().label }}</h2>
        <p-button
          icon="pi pi-trash"
          label="Delete"
          size="small"
          severity="danger"
          [outlined]="true"
          [loading]="busy()"
          (onClick)="confirmRemove()"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>{{ isEnabled() ? 'Enabled' : 'Disabled' }}</strong
          ><small class="ac-muted">{{
            isEnabled() ? 'Its activity joins the feed.' : 'Kept with its settings, adds nothing.'
          }}</small>
        </div>
        <p-toggleswitch
          [ngModel]="isEnabled()"
          (ngModelChange)="setEnabled($event)"
          [disabled]="busy()"
          ariaLabel="Enable data source"
        />
      </div>
      <ac-source-config [fields]="source().config" [sourceKey]="source().key" />
      <div class="row stacked">
        <div class="label">
          <strong>Add custom instruction for this datasource</strong
          ><small class="ac-muted"
            >Given to the AI when it summarizes your day from this source (e.g. "Group by client,
            skip newsletters").</small
          >
        </div>
        <textarea
          pTextarea
          [rows]="3"
          [autoResize]="true"
          [maxlength]="maxInstructionChars"
          [ngModel]="text(instructionKey())"
          (ngModelChange)="save(instructionKey(), $event)"
          [attr.aria-label]="'Custom instruction for ' + source().label"
        ></textarea>
      </div>
    </section>
  `,
  styleUrl: '../settings/sections/section.scss',
  styles: `
    :host {
      display: block;
    }
    .group {
      grid-template-columns: minmax(0, 1fr);
      margin-bottom: 0;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcePanelComponent extends SettingsSection {
  private readonly api = inject(ActivityApi);
  private readonly confirm = inject(ConfirmationService);

  /** Added source (active or disabled). */
  readonly source = input.required<DataSourceInfo>();
  /** Emitted once the source is removed from the Activity page. */
  readonly removed = output();

  protected readonly maxInstructionChars = MAX_INSTRUCTION_CHARS;
  protected readonly busy = signal(false);
  protected readonly isEnabled = computed(() => this.source().state === 'active');
  protected readonly instructionKey = computed(() => `activity_${this.source().key}_instruction`);

  /**
   * Turn the source on or off.
   *
   * @param isEnabled - New state.
   */
  protected async setEnabled(isEnabled: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.setEnabled(this.source().key, isEnabled);
    } finally {
      this.busy.set(false);
    }
  }

  /** Ask, then remove the source and reset its settings. */
  protected confirmRemove(): void {
    const { key, label } = this.source();
    this.confirm.confirm({
      header: 'Delete data source',
      message: `Remove ${label} from Activity? Its settings and custom instruction are reset. Nothing is deleted from ${label} itself.`,
      acceptButtonProps: { label: 'Delete', severity: 'danger' },
      rejectButtonProps: { label: 'Cancel', severity: 'secondary', text: true },
      accept: () => void this.remove(key),
    });
  }

  /**
   * Remove the source.
   *
   * @param key - Source key.
   */
  private async remove(key: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.remove(key);
      this.removed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}

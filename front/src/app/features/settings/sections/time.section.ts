import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ColorPickerModule } from 'primeng/colorpicker';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import { SettingsSection } from './settings-section';

/** Time page: daily target and the long-term progress banner. */
@Component({
  selector: 'ac-time-section',
  imports: [
    FormsModule,
    ColorPickerModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    ToggleSwitchModule,
  ],
  template: `
    <section class="group" id="time">
      <h2>Time</h2>
      <div class="row">
        <div class="label">
          <strong>Daily target</strong
          ><small class="ac-muted">Hours per day used by Time and Home.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('target_hourly_working_time', 7.5)"
          (ngModelChange)="save('target_hourly_working_time', $event ?? 7.5)"
          [min]="0"
          [max]="24"
          [step]="0.5"
          mode="decimal"
          [maxFractionDigits]="1"
          [showButtons]="true"
          ariaLabel="Daily target"
        />
      </div>

      <h3 class="subhead" id="progress">Progress banner</h3>
      <p class="intro ac-muted">
        Banner at the top of the Time page tracking a long-term goal such as a PhD.
      </p>
      <div class="row">
        <div class="label">
          <strong>Show on Time page</strong>
        </div>
        <p-toggleswitch
          [ngModel]="flag('calendar_progress_bar_enabled')"
          (ngModelChange)="save('calendar_progress_bar_enabled', $event, true)"
          ariaLabel="Show progress banner"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Title</strong></div>
        <input
          pInputText
          [ngModel]="text('calendar_progress_bar_title')"
          (ngModelChange)="save('calendar_progress_bar_title', $event)"
          aria-label="Banner title"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Dates</strong></div>
        <div class="inline">
          <p-datepicker
            [ngModel]="startDate()"
            (ngModelChange)="saveDate('calendar_progress_bar_start_date', $event)"
            dateFormat="yy-mm-dd"
            appendTo="body"
            ariaLabel="Start date"
          />
          <p-datepicker
            [ngModel]="endDate()"
            (ngModelChange)="saveDate('calendar_progress_bar_end_date', $event)"
            dateFormat="yy-mm-dd"
            appendTo="body"
            ariaLabel="End date"
          />
        </div>
      </div>
      <div class="row">
        <div class="label"><strong>Colors</strong></div>
        <div class="inline">
          <p-colorpicker
            [ngModel]="text('calendar_progress_bar_color1', '#7700a7')"
            (ngModelChange)="save('calendar_progress_bar_color1', $event)"
            format="hex"
            appendTo="body"
          />
          <p-colorpicker
            [ngModel]="text('calendar_progress_bar_color2', '#2563eb')"
            (ngModelChange)="save('calendar_progress_bar_color2', $event)"
            format="hex"
            appendTo="body"
          />
        </div>
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeSectionComponent extends SettingsSection {
  /** Stable Date objects: a new instance per check would make ngModel rewrite the picker forever. */
  protected readonly startDate = computed(() => this.date('calendar_progress_bar_start_date'));
  protected readonly endDate = computed(() => this.date('calendar_progress_bar_end_date'));

  /**
   * Date setting.
   *
   * @param key - Key.
   * @returns Date or null.
   */
  private date(key: string): Date | null {
    return parseLocalDate(this.text(key));
  }

  /**
   * Save a date setting.
   *
   * @param key - Key.
   * @param date - Date.
   */
  protected saveDate(key: string, date: Date | null): void {
    if (date !== null) {
      this.save(key, formatLocalDate(date), true);
    }
  }
}

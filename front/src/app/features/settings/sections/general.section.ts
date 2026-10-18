import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ColorPickerModule } from 'primeng/colorpicker';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import { ThemeService } from '../../../core/theme/theme.service';
import { SettingsSection } from './settings-section';

const VIEW_OPTIONS = [
  { value: 0, label: 'Cards' },
  { value: 1, label: 'List' },
  { value: 2, label: 'Table' },
];
const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];
const VIEW_SETTINGS = [
  { key: 'explorer_default_representation_mode', label: 'Library' },
  { key: 'projects_default_representation_mode', label: 'Project files' },
  { key: 'chat_files_default_representation_mode', label: 'Assistant file picker' },
];

/** Appearance, general defaults and the progress banner. */
@Component({
  selector: 'ac-general-section',
  imports: [
    FormsModule,
    ColorPickerModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    SelectButtonModule,
    SliderModule,
    ToggleSwitchModule,
  ],
  template: `
    <section class="group" id="appearance">
      <h2>Appearance</h2>
      <div class="row">
        <div class="label">
          <strong>Theme</strong><small class="ac-muted">Saved in this browser.</small>
        </div>
        <p-selectbutton
          [options]="themes"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="theme.mode()"
          (ngModelChange)="theme.mode.set($event)"
          ariaLabel="Theme"
        />
      </div>
    </section>

    <section class="group" id="general">
      <h2>General</h2>
      <div class="row">
        <div class="label">
          <strong>Inline display limit</strong
          ><small class="ac-muted"
            >Text, tables and TIFF above this size (MB) ask before loading. -1 disables.</small
          >
        </div>
        <p-inputnumber
          [ngModel]="num('auto_display_file_size_limit', 10)"
          (ngModelChange)="save('auto_display_file_size_limit', $event ?? -1)"
          [min]="-1"
          [showButtons]="true"
          ariaLabel="Inline display limit"
        />
      </div>
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
      <div class="row">
        <div class="label">
          <strong>Default search range</strong
          ><small class="ac-muted">Days searched when no range is chosen.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('search_default_timeframe_days', 30)"
          (ngModelChange)="save('search_default_timeframe_days', $event ?? 30)"
          [min]="1"
          [showButtons]="true"
          ariaLabel="Default search range"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Semantic similarity</strong
          ><small class="ac-muted"
            >Threshold of semantic search ({{
              num('semantic_similarity_threshold', 0.4).toFixed(2)
            }}).</small
          >
        </div>
        <p-slider
          class="slider"
          [ngModel]="num('semantic_similarity_threshold', 0.4)"
          (ngModelChange)="save('semantic_similarity_threshold', $event)"
          [min]="0"
          [max]="1"
          [step]="0.05"
          ariaLabel="Semantic similarity"
        />
      </div>
      @for (view of viewSettings; track view.key) {
        <div class="row">
          <div class="label">
            <strong>{{ view.label }} view</strong>
          </div>
          <p-selectbutton
            [options]="views"
            optionValue="value"
            [allowEmpty]="false"
            [ngModel]="num(view.key, 1)"
            (ngModelChange)="save(view.key, $event, true)"
            size="small"
            [ariaLabel]="view.label + ' view'"
          />
        </div>
      }
    </section>

    <section class="group" id="progress">
      <h2>Progress banner</h2>
      <div class="row">
        <div class="label">
          <strong>Show on Time</strong
          ><small class="ac-muted">A long-term goal such as a PhD.</small>
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
export class GeneralSectionComponent extends SettingsSection {
  protected readonly theme = inject(ThemeService);
  protected readonly views = VIEW_OPTIONS;
  protected readonly themes = THEME_OPTIONS;
  protected readonly viewSettings = VIEW_SETTINGS;
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

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ColorPickerModule } from 'primeng/colorpicker';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { formatLocalDate, parseLocalDate } from '@domain/time';
import {
  type AppearancePrefs,
  DEFAULT_APPEARANCE,
  FONT_SCALES,
  type FontFamilyKey,
  isHexColor,
  type SurfaceKey,
} from '../../../core/theme/appearance';
import { AppearanceService } from '../../../core/theme/appearance.service';
import { BRAND_COLOR } from '../../../core/theme/athena-preset';
import { ThemeService } from '../../../core/theme/theme.service';
import { DEFAULT_DAILY_TEXT_KIND, DEFAULT_DAILY_TEXT_LANGUAGE } from '../../home/daily-text';
import { SettingsSection } from './settings-section';

/** Optional keys unlocking more Home text providers. */
const DAILY_KEYS = [
  {
    key: 'api_ninjas_api_key',
    label: 'API Ninjas key',
    hint: 'More English quotes and motivation.',
    url: 'https://api-ninjas.com/register',
  },
  {
    key: 'blagues_api_token',
    label: 'Blagues API token',
    hint: 'More French jokes.',
    url: 'https://www.blagues-api.fr/',
  },
];
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
const PERCENT = 100;
const FONT_SCALE_OPTIONS = FONT_SCALES.map((scale) => ({
  value: scale,
  label: `${Math.round(scale * PERCENT)}%`,
}));
const FONT_FAMILY_OPTIONS: { value: FontFamilyKey; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'system', label: 'System' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];
const SURFACE_OPTIONS: { value: SurfaceKey; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'slate', label: 'Slate (cool)' },
  { value: 'gray', label: 'Gray' },
  { value: 'zinc', label: 'Zinc' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'stone', label: 'Stone (warm)' },
];
const ACCENT_SWATCHES = [
  { value: BRAND_COLOR, label: 'Purple (default)' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#0d9488', label: 'Teal' },
  { value: '#16a34a', label: 'Green' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#e11d48', label: 'Rose' },
];
const DAILY_KIND_OPTIONS = [
  { value: 'greeting', label: 'Greeting' },
  { value: 'motivation', label: 'Motivation' },
  { value: 'quote', label: 'Quote' },
  { value: 'joke', label: 'Joke' },
];
const DAILY_LANGUAGE_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
];
const VIEW_SETTINGS = [
  { key: 'explorer_default_representation_mode', label: 'Library' },
  { key: 'projects_default_representation_mode', label: 'Project files' },
  { key: 'chat_files_default_representation_mode', label: 'Assistant file picker' },
];

/**
 * Whether preferences match the default look.
 *
 * @param prefs - Preferences.
 * @returns True when unchanged.
 */
function sameLook(prefs: AppearancePrefs): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as (keyof AppearancePrefs)[]).every(
    (key) => prefs[key] === DEFAULT_APPEARANCE[key],
  );
}

/** Appearance, Home, general defaults and the Time progress banner, in one card. */
@Component({
  selector: 'ac-general-section',
  imports: [
    FormsModule,
    ButtonModule,
    ColorPickerModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    PasswordModule,
    SelectModule,
    SelectButtonModule,
    SliderModule,
    ToggleSwitchModule,
  ],
  template: `
    <section class="group" id="general">
      <h2>General</h2>

      <div class="heading subhead" id="appearance">
        <h3>Appearance</h3>
        <p-button
          label="Reset"
          icon="pi pi-refresh"
          size="small"
          [text]="true"
          [disabled]="isDefaultLook()"
          (onClick)="appearance.reset()"
        />
      </div>
      <p class="intro ac-muted">Saved in this browser.</p>
      <div class="row">
        <div class="label"><strong>Theme</strong></div>
        <p-selectbutton
          [options]="themes"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="theme.mode()"
          (ngModelChange)="theme.mode.set($event)"
          size="small"
          ariaLabel="Theme"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Text size</strong></div>
        <p-selectbutton
          [options]="fontScales"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="appearance.prefs().fontScale"
          (ngModelChange)="appearance.update({ fontScale: $event })"
          size="small"
          ariaLabel="Text size"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Font</strong></div>
        <p-selectbutton
          [options]="fontFamilies"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="appearance.prefs().fontFamily"
          (ngModelChange)="appearance.update({ fontFamily: $event })"
          size="small"
          ariaLabel="Font"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Background tone</strong></div>
        <p-select
          [options]="surfaces"
          optionValue="value"
          [ngModel]="appearance.prefs().surface"
          (ngModelChange)="appearance.update({ surface: $event })"
          appendTo="body"
          ariaLabel="Background tone"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Accent color</strong></div>
        <div class="inline">
          @for (swatch of accents; track swatch.value) {
            <button
              type="button"
              class="swatch"
              [class.selected]="appearance.prefs().accent === swatch.value"
              [style.background]="swatch.value"
              [attr.aria-label]="swatch.label"
              [attr.aria-pressed]="appearance.prefs().accent === swatch.value"
              (click)="saveAccent(swatch.value)"
            ></button>
          }
          <p-colorpicker
            [ngModel]="appearance.prefs().accent"
            (ngModelChange)="saveAccent($event)"
            format="hex"
            appendTo="body"
          />
        </div>
      </div>

      <h3 class="subhead" id="home">Home</h3>
      <div class="row">
        <div class="label">
          <strong>Daily text</strong
          ><small class="ac-muted"
            >Shown at the top of Home, fetched online once a day. Offline: a general sentence until
            the connection is back.</small
          >
        </div>
        <p-selectbutton
          [options]="dailyKinds"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="text('home_daily_text_kind', defaultKind)"
          (ngModelChange)="save('home_daily_text_kind', $event, true)"
          size="small"
          ariaLabel="Daily text"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Daily text language</strong>
        </div>
        <p-selectbutton
          [options]="dailyLanguages"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="text('home_daily_text_language', defaultLanguage)"
          (ngModelChange)="save('home_daily_text_language', $event, true)"
          size="small"
          ariaLabel="Daily text language"
        />
      </div>
      @for (item of dailyKeys; track item.key) {
        <div class="row">
          <div class="label">
            <strong>{{ item.label }}</strong
            ><small class="ac-muted"
              >{{ item.hint }} Optional.
              <a [href]="item.url" target="_blank" rel="noopener noreferrer">Get a key</a></small
            >
          </div>
          <p-password
            [ngModel]="text(item.key)"
            (ngModelChange)="save(item.key, $event)"
            [feedback]="false"
            [toggleMask]="true"
            autocomplete="off"
            [ariaLabel]="item.label"
          />
        </div>
      }

      <h3 class="subhead" id="defaults">Defaults</h3>
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

      <h3 class="subhead" id="progress">Time progress banner</h3>
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
export class GeneralSectionComponent extends SettingsSection {
  protected readonly theme = inject(ThemeService);
  protected readonly appearance = inject(AppearanceService);
  protected readonly fontScales = FONT_SCALE_OPTIONS;
  protected readonly fontFamilies = FONT_FAMILY_OPTIONS;
  protected readonly surfaces = SURFACE_OPTIONS;
  protected readonly accents = ACCENT_SWATCHES;
  protected readonly isDefaultLook = computed(() => sameLook(this.appearance.prefs()));
  protected readonly views = VIEW_OPTIONS;
  protected readonly themes = THEME_OPTIONS;
  protected readonly viewSettings = VIEW_SETTINGS;
  protected readonly dailyKinds = DAILY_KIND_OPTIONS;
  protected readonly dailyLanguages = DAILY_LANGUAGE_OPTIONS;
  protected readonly dailyKeys = DAILY_KEYS;
  protected readonly defaultKind = DEFAULT_DAILY_TEXT_KIND;
  protected readonly defaultLanguage = DEFAULT_DAILY_TEXT_LANGUAGE;
  /** Stable Date objects: a new instance per check would make ngModel rewrite the picker forever. */
  protected readonly startDate = computed(() => this.date('calendar_progress_bar_start_date'));
  protected readonly endDate = computed(() => this.date('calendar_progress_bar_end_date'));

  /**
   * Save the accent color (the picker may omit the `#`).
   *
   * @param color - Picked color.
   */
  protected saveAccent(color: string): void {
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (isHexColor(hex)) {
      this.appearance.update({ accent: hex.toLowerCase() });
    }
  }

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

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ColorPickerModule } from 'primeng/colorpicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SliderModule } from 'primeng/slider';
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
import { SettingsSection } from './settings-section';

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

/** Appearance and app-wide file and search defaults, in one card. */
@Component({
  selector: 'ac-general-section',
  imports: [
    FormsModule,
    ButtonModule,
    ColorPickerModule,
    InputNumberModule,
    SelectModule,
    SelectButtonModule,
    SliderModule,
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

      <h3 class="subhead" id="files-search">Files &amp; search</h3>
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
  protected readonly themes = THEME_OPTIONS;

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
}

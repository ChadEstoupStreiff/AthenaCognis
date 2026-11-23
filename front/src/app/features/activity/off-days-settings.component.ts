import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ChipModule } from 'primeng/chip';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ActivityGenerationApi } from '../../core/activity/activity-generation.api';
import {
  AGENDA_KEYWORDS_SETTING,
  AGENDA_OFF_SETTING,
  DEFAULT_AGENDA_KEYWORDS,
  HOLIDAYS_COUNTRY_SETTING,
  HOLIDAYS_SUBDIVISION_SETTING,
  OFF_DAYS_SETTING,
  offDayItem,
  offDayLabel,
  offDays,
} from '../../core/activity/day-status';
import { SettingsSection } from '../settings/sections/settings-section';

/** Locale of the country names. */
const COUNTRY_LOCALE = 'en';
const REGION_NAMES = new Intl.DisplayNames([COUNTRY_LOCALE], { type: 'region' });

/** Choice of a select. */
interface Choice {
  readonly value: string;
  readonly label: string;
}

/**
 * Name of a country code.
 *
 * @param code - Two-letter code.
 * @returns English name, the code itself when unknown.
 */
function countryName(code: string): string {
  return REGION_NAMES.of(code) ?? code;
}

/** Non working days of the daily schedule: holidays, off days, agenda events. */
@Component({
  selector: 'ac-off-days-settings',
  imports: [
    FormsModule,
    ButtonModule,
    ChipModule,
    DatePickerModule,
    InputTextModule,
    SelectModule,
    ToggleSwitchModule,
  ],
  templateUrl: './off-days-settings.component.html',
  styleUrl: '../settings/sections/section.scss',
  styles: `
    :host {
      display: contents;
    }
    .add {
      display: flex;
      gap: 8px;
    }
    .add p-datepicker {
      flex: 1;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    p-select {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffDaysSettingsComponent extends SettingsSection {
  private readonly api = inject(ActivityGenerationApi);

  protected readonly keywordsKey = AGENDA_KEYWORDS_SETTING;
  protected readonly agendaKey = AGENDA_OFF_SETTING;
  protected readonly defaultKeywords = DEFAULT_AGENDA_KEYWORDS;
  protected readonly offDayLabel = offDayLabel;
  /** Day or span being picked before it is added. */
  protected readonly pickedRange = signal<(Date | null)[] | null>(null);
  protected readonly canAdd = computed(() => offDayItem(this.pickedRange()) !== null);

  private readonly countries = resource({ loader: () => this.api.holidayCountries() });
  /** Countries by name (PrimeNG options). */
  protected readonly countryChoices = computed<Choice[]>(() =>
    Object.keys(this.countries.hasValue() ? this.countries.value() : {})
      .map((code) => ({ value: code, label: countryName(code) }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  );
  /** Subdivisions of the picked country (PrimeNG options). */
  protected readonly subdivisionChoices = computed<Choice[]>(() => {
    const codes = this.countries.hasValue() ? this.countries.value()[this.country()] : undefined;
    return (codes ?? []).map((code) => ({ value: code, label: code }));
  });

  /**
   * Country of the public holidays.
   *
   * @returns Code, "" when none.
   */
  protected country(): string {
    return this.text(HOLIDAYS_COUNTRY_SETTING);
  }

  /**
   * Subdivision of the public holidays.
   *
   * @returns Code, "" for the whole country.
   */
  protected subdivision(): string {
    return this.text(HOLIDAYS_SUBDIVISION_SETTING);
  }

  /**
   * Off days and spans.
   *
   * @returns Stored items, sorted.
   */
  protected offDays(): readonly string[] {
    return this.stableList(OFF_DAYS_SETTING, []);
  }

  /**
   * Pick the country of the public holidays (its subdivision is reset).
   *
   * @param code - Code, null when cleared.
   */
  protected pickCountry(code: string | null): void {
    this.save(HOLIDAYS_COUNTRY_SETTING, code ?? '', true);
    this.save(HOLIDAYS_SUBDIVISION_SETTING, '', true);
  }

  /**
   * Pick the subdivision of the public holidays.
   *
   * @param code - Code, null for the whole country.
   */
  protected pickSubdivision(code: string | null): void {
    this.save(HOLIDAYS_SUBDIVISION_SETTING, code ?? '', true);
  }

  /** Add the picked day or span to the off days. */
  protected addOffDay(): void {
    const item = offDayItem(this.pickedRange());
    if (item === null) {
      return;
    }
    const items = offDays(this.writer.value(OFF_DAYS_SETTING)).filter((stored) => stored !== item);
    this.save(OFF_DAYS_SETTING, offDays([...items, item]), true);
    this.pickedRange.set(null);
  }

  /**
   * Remove an off day or span.
   *
   * @param item - Stored item.
   */
  protected removeOffDay(item: string): void {
    this.save(
      OFF_DAYS_SETTING,
      this.offDays().filter((stored) => stored !== item),
      true,
    );
  }
}

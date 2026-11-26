import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PasswordModule } from 'primeng/password';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { DEFAULT_DAILY_TEXT_KIND, DEFAULT_DAILY_TEXT_LANGUAGE } from '../../home/daily-text';
import { SettingsSection } from './settings-section';

const DAILY_ENABLED = {
  key: 'home_daily_text_enabled',
  label: 'Daily text',
  hint: 'Show a text at the top of Home, fetched online once a day. Offline: a general sentence until the connection is back.',
};
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

/** Home page: daily text at the top and its optional provider keys. */
@Component({
  selector: 'ac-home-section',
  imports: [FormsModule, PasswordModule, SelectButtonModule, ToggleSwitchModule],
  template: `
    <section class="group" id="home">
      <h2>Home</h2>
      <div class="row">
        <div class="label">
          <strong>{{ dailyEnabled.label }}</strong
          ><small class="ac-muted">{{ dailyEnabled.hint }}</small>
        </div>
        <p-toggleswitch
          [ngModel]="flag(dailyEnabled.key)"
          (ngModelChange)="save(dailyEnabled.key, $event, true)"
          [ariaLabel]="dailyEnabled.label"
        />
      </div>
      @if (flag(dailyEnabled.key)) {
        <div class="row">
          <div class="label">
            <strong>Daily text kind</strong>
          </div>
          <p-selectbutton
            [options]="dailyKinds"
            optionValue="value"
            [allowEmpty]="false"
            [ngModel]="text('home_daily_text_kind', defaultKind)"
            (ngModelChange)="save('home_daily_text_kind', $event, true)"
            size="small"
            ariaLabel="Daily text kind"
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
      }
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeSectionComponent extends SettingsSection {
  protected readonly dailyEnabled = DAILY_ENABLED;
  protected readonly dailyKinds = DAILY_KIND_OPTIONS;
  protected readonly dailyLanguages = DAILY_LANGUAGE_OPTIONS;
  protected readonly dailyKeys = DAILY_KEYS;
  protected readonly defaultKind = DEFAULT_DAILY_TEXT_KIND;
  protected readonly defaultLanguage = DEFAULT_DAILY_TEXT_LANGUAGE;
}

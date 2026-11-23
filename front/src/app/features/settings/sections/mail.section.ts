import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { MailView } from '@domain/contracts';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { VIEW_META } from '../../mail/mail-model';
import { MailAccountsComponent } from './mail-accounts.section';
import { SettingsSection } from './settings-section';

const AUTO_PREVIEW = 'mail_auto_preview';
const AUTO_PREVIEW_BOXES = 'mail_auto_preview_boxes';
const DEFAULT_BOXES: readonly MailView[] = ['priority', 'inbox'];
/** Boxes new received mail can be sorted into at sync time. */
const PREVIEW_BOXES: ReadonlySet<MailView> = new Set([
  'priority',
  'inbox',
  'unread',
  'flagged',
  'others',
  'all',
]);
const AUTO_FETCH = {
  key: 'mail_auto_fetch',
  label: 'Auto fetch',
  hint: 'Fetch new mail of every account in the background, even with the Mail page closed.',
};
const FETCH_FREQUENCY = {
  key: 'mail_auto_fetch_minutes',
  label: 'Fetch frequency',
  hint: 'Minutes between two background fetches.',
  fallback: 5,
  min: 1,
  max: 1440,
};
const NAV_BADGE = {
  key: 'mail_nav_badge',
  label: 'Unread badge',
  hint: 'Show the number of unread Inbox messages on Mail in the navigation rail.',
};
const ACTIVITY_RESET = {
  key: 'mail_activity_reset_time',
  label: 'Activity reset time',
  hint: 'Mail flagged for Activity (yellow lightning) counts for the current day only. Flags made before this time count for the day before.',
  fallback: '04:00',
};
const TRASH_RETENTION = {
  key: 'mail_trash_retention_days',
  label: 'Trash retention',
  hint: 'Days deleted mail and drafts stay in the Trash, restorable in one click. Removed for good after.',
  fallback: 30,
  min: 1,
  max: 3650,
};
const DOWNLOAD_IMAGES = {
  key: 'mail_auto_download_images',
  label: 'Auto-download images',
  hint: 'Load remote images when a mail opens. Off: senders cannot track when you read them.',
};

/** Mail client options. */
@Component({
  selector: 'ac-mail-section',
  imports: [
    FormsModule,
    InputNumberModule,
    InputTextModule,
    MultiSelectModule,
    ToggleSwitchModule,
    MailAccountsComponent,
  ],
  template: `
    <section class="group" id="mail">
      <h2>Mail</h2>
      <ac-mail-accounts />
      <div class="row">
        <div class="label">
          <strong>{{ autoFetch.label }}</strong
          ><small class="ac-muted">{{ autoFetch.hint }}</small>
        </div>
        <p-toggleswitch
          [ngModel]="flag(autoFetch.key)"
          (ngModelChange)="save(autoFetch.key, $event, true)"
          [ariaLabel]="autoFetch.label"
        />
      </div>
      @if (flag(autoFetch.key)) {
        <div class="row">
          <div class="label">
            <strong>{{ fetchFrequency.label }}</strong
            ><small class="ac-muted">{{ fetchFrequency.hint }}</small>
          </div>
          <p-inputnumber
            [ngModel]="num(fetchFrequency.key, fetchFrequency.fallback)"
            (ngModelChange)="save(fetchFrequency.key, $event ?? fetchFrequency.fallback)"
            [min]="fetchFrequency.min"
            [max]="fetchFrequency.max"
            [showButtons]="true"
            suffix=" min"
            [ariaLabel]="fetchFrequency.label"
          />
        </div>
      }
      <div class="row">
        <div class="label">
          <strong>{{ navBadge.label }}</strong
          ><small class="ac-muted">{{ navBadge.hint }}</small>
        </div>
        <p-toggleswitch
          [ngModel]="flag(navBadge.key)"
          (ngModelChange)="save(navBadge.key, $event, true)"
          [ariaLabel]="navBadge.label"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Auto-generate Mail Preview</strong
          ><small class="ac-muted"
            >AI title and 40-word summary of new received mail (model: AI routing → Mail
            Preview).</small
          >
        </div>
        <p-toggleswitch
          [ngModel]="flag(autoPreview)"
          (ngModelChange)="save(autoPreview, $event, true)"
          ariaLabel="Auto-generate Mail Preview"
        />
      </div>
      @if (flag(autoPreview)) {
        <div class="row">
          <div class="label">
            <strong>Boxes</strong
            ><small class="ac-muted">Only new mail landing in these boxes gets a preview.</small>
          </div>
          <p-multiselect
            [options]="boxOptions"
            optionLabel="label"
            optionValue="view"
            [ngModel]="boxes()"
            (ngModelChange)="save(autoPreviewBoxes, $event, true)"
            display="chip"
            placeholder="No box"
            appendTo="body"
            ariaLabel="Boxes with automatic Mail Preview"
          />
        </div>
      }
      <div class="row">
        <div class="label">
          <strong>{{ activityReset.label }}</strong
          ><small class="ac-muted">{{ activityReset.hint }}</small>
        </div>
        <input
          pInputText
          type="time"
          required
          [ngModel]="text(activityReset.key, activityReset.fallback)"
          (ngModelChange)="saveResetTime($event)"
          [attr.aria-label]="activityReset.label"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>{{ trashRetention.label }}</strong
          ><small class="ac-muted">{{ trashRetention.hint }}</small>
        </div>
        <p-inputnumber
          [ngModel]="num(trashRetention.key, trashRetention.fallback)"
          (ngModelChange)="save(trashRetention.key, $event ?? trashRetention.fallback)"
          [min]="trashRetention.min"
          [max]="trashRetention.max"
          [showButtons]="true"
          suffix=" days"
          [ariaLabel]="trashRetention.label"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>{{ downloadImages.label }}</strong
          ><small class="ac-muted">{{ downloadImages.hint }}</small>
        </div>
        <p-toggleswitch
          [ngModel]="flag(downloadImages.key)"
          (ngModelChange)="save(downloadImages.key, $event, true)"
          [ariaLabel]="downloadImages.label"
        />
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailSectionComponent extends SettingsSection {
  protected readonly autoPreview = AUTO_PREVIEW;
  protected readonly autoPreviewBoxes = AUTO_PREVIEW_BOXES;
  protected readonly downloadImages = DOWNLOAD_IMAGES;
  protected readonly autoFetch = AUTO_FETCH;
  protected readonly navBadge = NAV_BADGE;
  protected readonly fetchFrequency = FETCH_FREQUENCY;
  protected readonly activityReset = ACTIVITY_RESET;
  protected readonly trashRetention = TRASH_RETENTION;
  protected readonly boxOptions = VIEW_META.filter((meta) => PREVIEW_BOXES.has(meta.view));

  /**
   * Boxes picked for automatic Mail Preview.
   *
   * @returns Mailbox views (stable reference).
   */
  protected boxes(): readonly string[] {
    return this.stableList(AUTO_PREVIEW_BOXES, DEFAULT_BOXES);
  }

  /**
   * Store the activity reset time (an emptied field keeps the previous value).
   *
   * @param value - `HH:MM` from the time input.
   */
  protected saveResetTime(value: string): void {
    if (value) {
      this.save(ACTIVITY_RESET.key, value);
    }
  }
}

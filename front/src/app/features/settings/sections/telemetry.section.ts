import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { AppConfig } from '../../../core/config/app-config';
import { SettingsStore } from '../../../core/settings/settings.store';
import { TelemetryService } from '../../../core/telemetry/telemetry.service';

const COLLECTED = [
  ['nbr_files', 'Number of files'],
  ['nbr_projects / nbr_tags', 'Number of projects and tags'],
  ['nbr_calendars / nbr_hours', 'Time entries and hours tracked'],
  ['nbr_summaries / nbr_links', 'AI summaries and file links'],
  ['nbr_contacts', 'Number of contacts'],
  ['nbr_tasks / nbr_kanban_boards / nbr_validated_tasks', 'Tasks, boards and completed tasks'],
  ['files_without_tag / files_without_project', 'Unclassified files'],
  ['disk_files_bytes', 'Storage used by files'],
] as const;

/** Anonymous usage statistics. */
@Component({
  selector: 'ac-telemetry-section',
  imports: [ButtonModule, TagModule],
  template: `
    <section class="group" id="telemetry">
      <h2>Telemetry</h2>
      @if (!telemetry.configured()) {
        <p class="ac-muted intro">
          Not configured. Set <code>TELEMETRY_SERVER_URL</code> in <code>.env</code> to enable it.
        </p>
      } @else {
        <p class="ac-muted intro">
          Anonymous counters, at most once a day. No file names, content, keys or personal data. To
          get or delete your data, contact chad.estoup&#64;gmail.com.
        </p>
        <div class="row">
          <div class="label">
            <strong>Status</strong
            ><small class="ac-muted">{{
              lastSent() ? 'Last ping ' + lastSent() + ' (UTC)' : 'No ping sent yet'
            }}</small>
          </div>
          <div class="inline">
            @switch (telemetry.consent()) {
              @case (true) {
                <p-tag severity="success" value="Enabled" />
                <p-button
                  label="Disable"
                  size="small"
                  severity="secondary"
                  [outlined]="true"
                  (onClick)="telemetry.decide(false)"
                />
              }
              @case (false) {
                <p-tag severity="secondary" value="Disabled" />
                <p-button label="Enable" size="small" (onClick)="telemetry.decide(true)" />
              }
              @default {
                <p-tag severity="warn" value="Not decided" />
              }
            }
            <p-button
              label="Ask again"
              size="small"
              [text]="true"
              (onClick)="telemetry.decide(null)"
            />
          </div>
        </div>
        <div class="row">
          <div class="label"><strong>Installation id</strong></div>
          <code class="ac-muted">{{ uuid() || '—' }}</code>
        </div>
        @if (dashboard()) {
          <div class="row">
            <div class="label"><strong>Public dashboard</strong></div>
            <a [href]="dashboard()" target="_blank" rel="noopener noreferrer">Open statistics</a>
          </div>
        }
        <table class="collected">
          @for (item of collected; track item[0]) {
            <tr>
              <td>
                <code>{{ item[0] }}</code>
              </td>
              <td class="ac-muted">{{ item[1] }}</td>
            </tr>
          }
        </table>
      }
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetrySectionComponent {
  private readonly settings = inject(SettingsStore);
  private readonly config = inject(AppConfig);
  protected readonly telemetry = inject(TelemetryService);

  protected readonly collected = COLLECTED;
  protected readonly dashboard = computed(() => {
    const url = this.config.value().telemetryDashboardUrl;
    return /^https?:\/\//.test(url) ? url : '';
  });
  protected readonly lastSent = computed(() => this.stringSetting('telemetry_last_sent'));
  protected readonly uuid = computed(() => this.stringSetting('telemetry_uuid'));

  /**
   * String setting or empty.
   *
   * @param key - Key.
   * @returns Value.
   */
  private stringSetting(key: string): string {
    const value = this.settings.values()[key];
    return typeof value === 'string' ? value : '';
  }
}

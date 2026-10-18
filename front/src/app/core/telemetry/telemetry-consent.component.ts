import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TelemetryService } from './telemetry.service';

/** One-time consent prompt (the choice is shared with the Streamlit front). */
@Component({
  selector: 'ac-telemetry-consent',
  imports: [ButtonModule, DialogModule],
  template: `
    <p-dialog
      header="Help improve AthenaCognis"
      [modal]="true"
      [closable]="false"
      [visible]="telemetry.needsConsent()"
      [style]="{ width: 'min(520px, 96vw)' }"
    >
      <p>
        <strong>AthenaCognis</strong> can send anonymous usage statistics once a day to help the
        developer understand how the app is used. No personal data, file names or content is ever
        collected.
      </p>
      <p class="ac-muted">
        Only counters are sent (number of files, projects, tags, hours, summaries, links, tasks and
        storage used). You can change your choice in Settings.
      </p>
      <p>
        🙏 The number of users decides whether AthenaCognis can count as a scientific contribution
        of the developer's PhD thesis — accepting helps a lot.
      </p>
      <ng-template #footer>
        <p-button
          label="No thanks"
          severity="secondary"
          [text]="true"
          (onClick)="telemetry.decide(false)"
        />
        <p-button label="Accept" icon="pi pi-heart" (onClick)="telemetry.decide(true)" />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetryConsentComponent {
  protected readonly telemetry = inject(TelemetryService);
}

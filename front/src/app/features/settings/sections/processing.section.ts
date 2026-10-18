import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SettingsSection } from './settings-section';

const AUTO_JOBS = [
  { key: 'enable_auto_preview', label: 'Previews', hint: 'Thumbnails of uploaded files.' },
  { key: 'enable_auto_summary', label: 'Summaries', hint: 'Summary and keywords of text files.' },
  { key: 'enable_auto_ocr', label: 'Text in images', hint: 'OCR and captions of images.' },
  { key: 'enable_auto_transcription', label: 'Transcription', hint: 'Audio and video to text.' },
];
const QUALITY_OPTIONS = [
  { value: 'low', label: '144p' },
  { value: 'medium', label: '360p' },
  { value: 'high', label: '720p' },
];

/** Automatic processing on upload and preview options. */
@Component({
  selector: 'ac-processing-section',
  imports: [FormsModule, InputNumberModule, SelectButtonModule, ToggleSwitchModule],
  template: `
    <section class="group" id="processing">
      <h2>Processing</h2>
      <p class="ac-muted intro">
        Run automatically on every upload. Engines are set in AI routing.
      </p>
      @for (job of autoJobs; track job.key) {
        <div class="row">
          <div class="label">
            <strong>{{ job.label }}</strong
            ><small class="ac-muted">{{ job.hint }}</small>
          </div>
          <p-toggleswitch
            [ngModel]="flag(job.key)"
            (ngModelChange)="save(job.key, $event, true)"
            [ariaLabel]="job.label"
          />
        </div>
      }
      <div class="row">
        <div class="label"><strong>Preview quality</strong></div>
        <p-selectbutton
          [options]="qualities"
          optionValue="value"
          [allowEmpty]="false"
          [ngModel]="text('preview_quality', 'medium')"
          (ngModelChange)="save('preview_quality', $event, true)"
          size="small"
          ariaLabel="Preview quality"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Text preview</strong
          ><small class="ac-muted">Characters shown for text files.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('preview_text_chars', 300)"
          (ngModelChange)="save('preview_text_chars', $event ?? 300)"
          [min]="50"
          [max]="5000"
          [step]="50"
          [showButtons]="true"
          ariaLabel="Text preview characters"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Archive preview</strong
          ><small class="ac-muted">Entries listed for zip/tar files.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('preview_zip_subfiles', 15)"
          (ngModelChange)="save('preview_zip_subfiles', $event ?? 15)"
          [min]="1"
          [max]="100"
          [showButtons]="true"
          ariaLabel="Archive preview entries"
        />
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProcessingSectionComponent extends SettingsSection {
  protected readonly autoJobs = AUTO_JOBS;
  protected readonly qualities = QUALITY_OPTIONS;
}

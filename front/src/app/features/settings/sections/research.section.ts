import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DISCOVER_PERIODS, DISCOVER_SCOPES } from '@domain/sota';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { SettingsSection } from './settings-section';

/** Research defaults: the subject used to discover new papers and the default discovery selections. */
@Component({
  selector: 'ac-research-section',
  imports: [FormsModule, SelectModule, TextareaModule],
  template: `
    <section class="group" id="research">
      <h2>Research</h2>
      <div class="row stacked">
        <div class="label">
          <strong>My subject</strong
          ><small class="ac-muted"
            >Search query of your research. Research → Search papers → Discover related → “My
            subject” finds new papers matching it (OpenAlex keyword search on title, abstract and
            full text, 50 most relevant results). AI search reads it as a description and writes its
            own queries.</small
          >
          <small class="ac-muted"
            >Plain words are all required: a long sentence finds almost nothing. Write a Boolean
            query instead: <code>"exact phrase"</code>, <code>OR</code> between synonyms,
            <code>AND</code> between the 2–3 concepts that must all appear, <code>NOT</code> to drop
            noise, parentheses to group. Operators in UPPERCASE, no wildcards. Several topics → join
            groups with <code>OR</code>; keep each group narrow, broad groups fill the 50
            results.</small
          >
        </div>
        <textarea
          pTextarea
          [rows]="3"
          [autoResize]="true"
          placeholder='e.g. (("MRI" OR "magnetic resonance") AND ("histology" OR "whole slide image") AND ("registration" OR "co-registration")) OR (("ex vivo MRI" OR "high-field MRI") AND "histopathology")'
          [ngModel]="text('research_subject')"
          (ngModelChange)="save('research_subject', $event)"
          aria-label="My subject"
        ></textarea>
      </div>
      <div class="row">
        <div class="label">
          <strong>Default “Based on”</strong
          ><small class="ac-muted">Selection of Discover related when the app opens.</small>
        </div>
        <p-select
          [options]="scopes"
          optionLabel="label"
          optionValue="value"
          [ngModel]="text('research_default_scope', 'library')"
          (ngModelChange)="save('research_default_scope', $event, true)"
          appendTo="body"
          ariaLabel="Default Based on"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Default “Published”</strong
          ><small class="ac-muted"
            >Publication period of Discover related when the app opens.</small
          >
        </div>
        <p-select
          [options]="periods"
          optionLabel="label"
          optionValue="value"
          [ngModel]="text('research_default_period', '1')"
          (ngModelChange)="save('research_default_period', $event, true)"
          appendTo="body"
          ariaLabel="Default Published"
        />
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResearchSectionComponent extends SettingsSection {
  protected readonly scopes = [...DISCOVER_SCOPES];
  /** Periods with string values (stored as text settings). */
  protected readonly periods = DISCOVER_PERIODS.map((period) => ({
    label: period.label,
    value: String(period.value),
  }));
}

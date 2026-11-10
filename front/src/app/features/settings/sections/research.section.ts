import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';
import { SettingsSection } from './settings-section';

/** Research defaults: the subject used to discover new papers. */
@Component({
  selector: 'ac-research-section',
  imports: [FormsModule, TextareaModule],
  template: `
    <section class="group" id="research">
      <h2>Research</h2>
      <div class="row stacked">
        <div class="label">
          <strong>My subject</strong
          ><small class="ac-muted"
            >Search query of your research. Research → Search papers → Discover related → “My
            subject” finds new papers matching it (OpenAlex keyword search on title, abstract and
            full text, 50 most relevant results).</small
          >
          <small class="ac-muted"
            >Plain words are all required: a long sentence finds almost nothing. Write a Boolean
            query instead: <code>"exact phrase"</code>, <code>OR</code> between synonyms,
            <code>AND</code> between the 2–3 concepts that must all appear, <code>NOT</code> to drop
            noise, parentheses to group. Operators in UPPERCASE, no wildcards. Several topics →
            join groups with <code>OR</code>; keep each group narrow, broad groups fill the 50
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
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResearchSectionComponent extends SettingsSection {}

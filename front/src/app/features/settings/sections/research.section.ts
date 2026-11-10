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
            >Keywords or a short description of your research. Research → Search papers → Discover
            related → “My subject” finds new papers matching it.</small
          >
        </div>
        <textarea
          pTextarea
          [rows]="3"
          [autoResize]="true"
          placeholder="e.g. deep learning for medical image segmentation of tumors in CT scans"
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

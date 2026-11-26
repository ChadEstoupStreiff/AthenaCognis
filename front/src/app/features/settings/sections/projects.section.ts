import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ViewSettingComponent } from './view-setting';

/** Projects page options. */
@Component({
  selector: 'ac-projects-section',
  imports: [ViewSettingComponent],
  template: `
    <section class="group" id="projects">
      <h2>Projects</h2>
      <ac-view-setting key="projects_default_representation_mode" label="Project files view" />
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsSectionComponent {}

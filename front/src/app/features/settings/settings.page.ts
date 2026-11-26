import { afterNextRender, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { UpdateCheck } from '../../core/update/update-check';
import { AiSectionComponent } from './sections/ai.section';
import { AssistantSectionComponent } from './sections/assistant.section';
import { GeneralSectionComponent } from './sections/general.section';
import { HomeSectionComponent } from './sections/home.section';
import { LibrarySectionComponent } from './sections/library.section';
import { MailSectionComponent } from './sections/mail.section';
import { NavigationSectionComponent } from './sections/navigation.section';
import { ProjectsSectionComponent } from './sections/projects.section';
import { ProvidersSectionComponent } from './sections/providers.section';
import { ResearchSectionComponent } from './sections/research.section';
import { TagsSectionComponent } from './sections/tags.section';
import { TelemetrySectionComponent } from './sections/telemetry.section';
import { TimeSectionComponent } from './sections/time.section';
import { SettingsWriter } from './settings-writer';

/** Navigation entry of a section. */
interface SectionEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

/** Sections in page order: app-wide first, then one per page (rail order), then data and privacy. */
const SECTIONS: readonly SectionEntry[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'pi pi-sliders-h',
  },
  {
    id: 'navigation',
    label: 'Sidebar',
    icon: 'pi pi-bars',
  },
  {
    id: 'ai',
    label: 'AI routing',
    icon: 'pi pi-sitemap',
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: 'pi pi-key',
  },
  {
    id: 'home',
    label: 'Home',
    icon: 'pi pi-home',
  },
  {
    id: 'mail',
    label: 'Mail',
    icon: 'pi pi-envelope',
  },
  {
    id: 'library',
    label: 'Library',
    icon: 'pi pi-folder-open',
  },
  {
    id: 'time',
    label: 'Time',
    icon: 'pi pi-calendar',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'pi pi-briefcase',
  },
  {
    id: 'research',
    label: 'Research',
    icon: 'pi pi-book',
  },
  {
    id: 'assistant',
    label: 'Assistant',
    icon: 'pi pi-comments',
  },
  { id: 'tags', label: 'Tags', icon: 'pi pi-tags' },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: 'pi pi-chart-bar',
  },
];

/** Settings: every option on one scrollable page with anchors. */
@Component({
  selector: 'ac-settings-page',
  imports: [
    MessageModule,
    AiSectionComponent,
    AssistantSectionComponent,
    GeneralSectionComponent,
    HomeSectionComponent,
    LibrarySectionComponent,
    MailSectionComponent,
    NavigationSectionComponent,
    ProjectsSectionComponent,
    ProvidersSectionComponent,
    ResearchSectionComponent,
    TagsSectionComponent,
    TelemetrySectionComponent,
    TimeSectionComponent,
  ],
  providers: [SettingsWriter],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly updateCheck = inject(UpdateCheck);
  protected readonly sections = SECTIONS;

  /** Scroll to the section named by the URL fragment (`/settings#research`). */
  constructor() {
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    afterNextRender(() => {
      if (fragment !== null) {
        this.jump(fragment);
      }
    });
  }

  /**
   * Scroll to a section.
   *
   * @param id - Section id.
   */
  protected jump(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

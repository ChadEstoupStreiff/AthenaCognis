import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { AiSectionComponent } from './sections/ai.section';
import { AssistantSectionComponent } from './sections/assistant.section';
import { GeneralSectionComponent } from './sections/general.section';
import { MailSectionComponent } from './sections/mail.section';
import { NavigationSectionComponent } from './sections/navigation.section';
import { ProcessingSectionComponent } from './sections/processing.section';
import { ProvidersSectionComponent } from './sections/providers.section';
import { ResearchSectionComponent } from './sections/research.section';
import { TagsSectionComponent } from './sections/tags.section';
import { TelemetrySectionComponent } from './sections/telemetry.section';
import { SettingsWriter } from './settings-writer';

/** Navigation entry with the words it can be found by. */
interface SectionEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly keywords: string;
}

const SECTIONS: readonly SectionEntry[] = [
  {
    id: 'general',
    label: 'General',
    icon: 'pi pi-sliders-h',
    keywords:
      'appearance theme dark light font text size scale accent color colour background tone surface home daily quote joke motivation greeting language display limit target hours search semantic view cards list table time progress banner goal phd',
  },
  {
    id: 'navigation',
    label: 'Sidebar',
    icon: 'pi pi-bars',
    keywords: 'navigation sidebar rail menu tabs order reorder hide show visible',
  },
  {
    id: 'ai',
    label: 'AI routing',
    icon: 'pi pi-sitemap',
    keywords:
      'model provider assistant rewrite link summary caption ocr transcription whisper paper search research answer style verbose concise instruction',
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: 'pi pi-key',
    keywords:
      'api key mistral openai gemini groq anthropic claude ollama server install pull model',
  },
  {
    id: 'assistant',
    label: 'Assistant',
    icon: 'pi pi-comments',
    keywords: 'chat about me rag retrieval similarity presets timeout parallel',
  },
  {
    id: 'processing',
    label: 'Processing',
    icon: 'pi pi-cog',
    keywords: 'auto upload preview thumbnail quality summary ocr transcription archive',
  },
  {
    id: 'mail',
    label: 'Mail',
    icon: 'pi pi-envelope',
    keywords:
      'mail email account connect imap smtp exchange ews password signature preview ai summary images download tracking',
  },
  {
    id: 'research',
    label: 'Research',
    icon: 'pi pi-book',
    keywords:
      'my subject research papers discover topic keywords state of the art sota default based on published period',
  },
  { id: 'tags', label: 'Tags', icon: 'pi pi-tags', keywords: 'tag color rename delete projects' },
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: 'pi pi-chart-bar',
    keywords: 'statistics usage consent privacy',
  },
];

/** Settings: every option on one scrollable page with anchors and a filter. */
@Component({
  selector: 'ac-settings-page',
  imports: [
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    AiSectionComponent,
    AssistantSectionComponent,
    GeneralSectionComponent,
    ProcessingSectionComponent,
    MailSectionComponent,
    NavigationSectionComponent,
    ProvidersSectionComponent,
    ResearchSectionComponent,
    TagsSectionComponent,
    TelemetrySectionComponent,
  ],
  providers: [SettingsWriter],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly query = signal('');
  protected readonly visible = computed(() => {
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = SECTIONS.filter((section) =>
      words.every((word) => `${section.label} ${section.keywords}`.toLowerCase().includes(word)),
    );
    return new Set(matches.map((section) => section.id));
  });
  protected readonly sections = computed(() =>
    SECTIONS.filter((section) => this.visible().has(section.id)),
  );

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

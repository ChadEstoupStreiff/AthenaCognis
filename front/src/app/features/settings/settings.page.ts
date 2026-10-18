import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { AiSectionComponent } from './sections/ai.section';
import { AssistantSectionComponent } from './sections/assistant.section';
import { GeneralSectionComponent } from './sections/general.section';
import { ProcessingSectionComponent } from './sections/processing.section';
import { ProvidersSectionComponent } from './sections/providers.section';
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
      'appearance theme dark light display size limit target hours search semantic view cards list table progress banner phd',
  },
  {
    id: 'ai',
    label: 'AI routing',
    icon: 'pi pi-sitemap',
    keywords: 'model provider assistant rewrite link summary caption ocr transcription whisper',
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
    ProvidersSectionComponent,
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

  /**
   * Scroll to a section.
   *
   * @param id - Section id.
   */
  protected jump(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SliderModule } from 'primeng/slider';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { PresetsDialogComponent } from '../../assistant/presets-dialog.component';
import { SettingsSection } from './settings-section';

/** Assistant defaults, retrieval and limits. */
@Component({
  selector: 'ac-assistant-section',
  imports: [
    FormsModule,
    ButtonModule,
    InputNumberModule,
    SliderModule,
    TextareaModule,
    ToggleSwitchModule,
    PresetsDialogComponent,
  ],
  template: `
    <section class="group" id="assistant">
      <h2>Assistant</h2>
      <div class="row stacked">
        <div class="label">
          <strong>About me</strong
          ><small class="ac-muted">Sent with a message when “About me” is on.</small>
        </div>
        <textarea
          pTextarea
          [rows]="4"
          [autoResize]="true"
          [ngModel]="text('chat_user_description')"
          (ngModelChange)="save('chat_user_description', $event)"
          aria-label="About me"
        ></textarea>
      </div>
      <div class="row">
        <div class="label">
          <strong>Search files by default</strong
          ><small class="ac-muted">RAG: retrieve relevant files for each question.</small>
        </div>
        <p-toggleswitch
          [ngModel]="flag('chat_rag_enabled_default')"
          (ngModelChange)="save('chat_rag_enabled_default', $event, true)"
          ariaLabel="Search files by default"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Retrieved files</strong
          ><small class="ac-muted">Maximum files added per question.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('chat_rag_top_k', 5)"
          (ngModelChange)="save('chat_rag_top_k', $event ?? 5)"
          [min]="1"
          [max]="50"
          [showButtons]="true"
          ariaLabel="Retrieved files"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Retrieval similarity</strong
          ><small class="ac-muted"
            >Minimum similarity ({{ num('chat_rag_similarity_threshold', 0.4).toFixed(2) }}).</small
          >
        </div>
        <p-slider
          class="slider"
          [ngModel]="num('chat_rag_similarity_threshold', 0.4)"
          (ngModelChange)="save('chat_rag_similarity_threshold', $event)"
          [min]="0"
          [max]="1"
          [step]="0.05"
          ariaLabel="Retrieval similarity"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Parallel answers</strong
          ><small class="ac-muted">Conversations generating at once.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('chat_max_concurrent_generations', 3)"
          (ngModelChange)="save('chat_max_concurrent_generations', $event ?? 3)"
          [min]="1"
          [max]="20"
          [showButtons]="true"
          ariaLabel="Parallel answers"
        />
      </div>
      <div class="row">
        <div class="label">
          <strong>Answer timeout</strong
          ><small class="ac-muted">Seconds before a generation is stopped.</small>
        </div>
        <p-inputnumber
          [ngModel]="num('chat_llm_timeout_seconds', 300)"
          (ngModelChange)="save('chat_llm_timeout_seconds', $event ?? 300)"
          [min]="10"
          [step]="30"
          [showButtons]="true"
          ariaLabel="Answer timeout"
        />
      </div>
      <div class="row">
        <div class="label"><strong>Message presets</strong></div>
        <p-button
          label="Manage presets"
          icon="pi pi-bookmark"
          size="small"
          severity="secondary"
          [outlined]="true"
          (onClick)="managing.set(true)"
        />
      </div>
    </section>
    <ac-presets-dialog [(visible)]="managing" />
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantSectionComponent extends SettingsSection {
  protected readonly managing = signal(false);
}

import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { ApiClient, backendUrl } from '../../../core/api/api-client';
import { SettingsStore } from '../../../core/settings/settings.store';
import { AI_TASKS, type AiTask, modelsFor, type ProviderOption, providersFor } from '../ai-routing';
import { SettingsSection } from './settings-section';

/** Installed Ollama model (`GET /ollama/list`). */
interface OllamaModel {
  readonly name: string;
}

/** Routing of one task. */
interface RoutingRow {
  readonly task: AiTask;
  readonly provider: string;
  readonly model: string;
  readonly providers: ProviderOption[];
  readonly models: string[];
}

/** Which provider and model each AI task uses. */
@Component({
  selector: 'ac-ai-section',
  imports: [FormsModule, SelectModule],
  template: `
    <section class="group" id="ai">
      <h2>AI routing</h2>
      <p class="ac-muted intro">
        Pick the engine of each task. Cloud providers need an API key (Providers below). Ollama
        models must be installed first.
      </p>
      <div class="matrix">
        @for (row of rows(); track row.task.key) {
          <div class="matrix-row">
            <div class="label">
              <strong>{{ row.task.label }}</strong
              ><small class="ac-muted">{{ row.task.hint }}</small>
            </div>
            <p-select
              [options]="row.providers"
              optionLabel="label"
              optionValue="value"
              [ngModel]="row.provider"
              (ngModelChange)="setProvider(row.task, $event)"
              appendTo="body"
              [ariaLabel]="row.task.label + ' provider'"
            />
            @if (row.models.length > 0) {
              <p-select
                [options]="row.models"
                [ngModel]="row.model"
                (ngModelChange)="save(row.task.key + '_model', $event, true)"
                [filter]="row.models.length > 8"
                [editable]="row.provider === 'llama'"
                appendTo="body"
                [ariaLabel]="row.task.label + ' model'"
              />
            } @else {
              <span class="ac-muted">{{
                row.provider === 'llama' ? 'No Ollama model installed' : 'Built-in model'
              }}</span>
            }
          </div>
        }
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSectionComponent extends SettingsSection {
  private readonly api = inject(ApiClient);
  private readonly settings = inject(SettingsStore);

  private readonly ollama = resource({
    loader: () => this.api.get<OllamaModel[]>(backendUrl('/ollama/list'), { silent: true }),
  });
  private readonly installed = computed(() =>
    (this.ollama.value() ?? []).map((model) => model.name),
  );

  /** One row per task, recomputed only when settings or installed models change. */
  protected readonly rows = computed<readonly RoutingRow[]>(() => {
    this.settings.values();
    return AI_TASKS.map((task) => this.rowOf(task, this.installed()));
  });

  /**
   * Change provider and pick its first model.
   *
   * @param task - Task.
   * @param provider - Provider.
   */
  protected setProvider(task: AiTask, provider: string): void {
    this.save(`${task.key}_type`, provider, true);
    const first = modelsFor(task, provider, this.installed())[0];
    if (first !== undefined) {
      this.save(`${task.key}_model`, first, true);
    }
  }

  /**
   * Build a row (the current model stays listed even if unknown).
   *
   * @param task - Task.
   * @param installed - Installed Ollama models.
   * @returns Row.
   */
  private rowOf(task: AiTask, installed: readonly string[]): RoutingRow {
    const provider = this.text(`${task.key}_type`);
    const model = this.text(`${task.key}_model`);
    const list = modelsFor(task, provider, installed);
    const models =
      list.length === 0 || list.includes(model) || model === '' ? [...list] : [model, ...list];
    return { task, provider, model, providers: [...providersFor(task)], models };
  }
}

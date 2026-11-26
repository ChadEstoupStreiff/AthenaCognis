import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ApiClient, backendUrl } from '../../../core/api/api-client';
import { SettingsStore } from '../../../core/settings/settings.store';
import { AI_TASKS, type AiTask, modelsFor, type ProviderOption, providersFor } from '../ai-routing';
import {
  CUSTOM_PROVIDERS_KEY,
  type CustomProvider,
  isCustomProvider,
  parseCustomProviders,
} from '../custom-providers';
import { ModelCatalogStore } from '../model-catalog.store';
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
  readonly isCustom: boolean;
}

/** Which provider and model each AI task uses. */
@Component({
  selector: 'ac-ai-section',
  imports: [FormsModule, SelectModule, TextareaModule],
  template: `
    <section class="group" id="ai">
      <h2>AI routing</h2>
      <p class="ac-muted intro">
        Pick the engine of each task. Cloud providers need an API key (Providers below). Ollama
        models must be installed first. Model lists are built in until you press “Reload models”
        under Providers. Custom providers list theirs automatically; you can also type a model name.
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
            @if (row.models.length > 0 || row.isCustom) {
              <p-select
                [options]="row.models"
                [ngModel]="row.model"
                (ngModelChange)="setModel(row, $event)"
                [filter]="row.models.length > 8"
                [editable]="row.provider === 'llama' || row.isCustom"
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
      <div class="row stacked">
        <div class="label">
          <strong>Answer style</strong
          ><small class="ac-muted"
            >Instruction added to every text and assistant request (not OCR, captions or
            transcription, which must stay verbatim). Empty = no instruction.</small
          >
        </div>
        <textarea
          pTextarea
          [rows]="2"
          [autoResize]="true"
          [ngModel]="text('ai_style_instruction')"
          (ngModelChange)="save('ai_style_instruction', $event)"
          aria-label="Answer style instruction"
        ></textarea>
      </div>
    </section>
  `,
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSectionComponent extends SettingsSection {
  private readonly api = inject(ApiClient);
  private readonly settings = inject(SettingsStore);
  private readonly models = inject(ModelCatalogStore);

  private readonly ollama = resource({
    params: () => this.models.reloads(),
    loader: () => this.api.get<OllamaModel[]>(backendUrl('/ollama/list'), { silent: true }),
  });
  private readonly installed = computed(() =>
    (this.ollama.value() ?? []).map((model) => model.name),
  );

  /** One row per task, recomputed only when settings or installed models change. */
  protected readonly rows = computed<readonly RoutingRow[]>(() => {
    const custom = parseCustomProviders(this.settings.values()[CUSTOM_PROVIDERS_KEY]);
    return AI_TASKS.map((task) => this.rowOf(task, this.installed(), custom));
  });

  /** Load the model lists of custom providers, which have no built-in list. */
  constructor() {
    super();
    effect(() => {
      const custom = parseCustomProviders(this.settings.values()[CUSTOM_PROVIDERS_KEY]);
      untracked(() => void this.models.ensureListed(custom.map((provider) => provider.id)));
    });
  }

  /**
   * Change provider and pick its first model.
   *
   * @param task - Task.
   * @param provider - Provider.
   */
  protected setProvider(task: AiTask, provider: string): void {
    this.save(`${task.key}_type`, provider, true);
    const first = modelsFor(task, provider, this.installed(), this.models.catalog())[0];
    if (first !== undefined || isCustomProvider(provider)) {
      this.save(`${task.key}_model`, first ?? '', true);
    }
  }

  /**
   * Change model; an inherited routing becomes the task's own.
   *
   * @param row - Routing row.
   * @param model - Model.
   */
  protected setModel(row: RoutingRow, model: string): void {
    if (this.text(`${row.task.key}_type`) === '') {
      this.save(`${row.task.key}_type`, row.provider, true);
    }
    this.save(`${row.task.key}_model`, model, true);
  }

  /**
   * Build a row (the current model stays listed even if unknown).
   *
   * @param task - Task.
   * @param installed - Installed Ollama models.
   * @param custom - User-defined providers.
   * @returns Row.
   */
  private rowOf(
    task: AiTask,
    installed: readonly string[],
    custom: readonly CustomProvider[],
  ): RoutingRow {
    const own = this.text(`${task.key}_type`);
    const source = own === '' && task.fallbackKey !== undefined ? task.fallbackKey : task.key;
    const provider = this.text(`${source}_type`);
    const model = this.text(`${source}_model`);
    const list = modelsFor(task, provider, installed, this.models.catalog());
    const isCustom = isCustomProvider(provider);
    const isUnlisted = model !== '' && !list.includes(model) && (list.length > 0 || isCustom);
    const models = isUnlisted ? [model, ...list] : [...list];
    const providers = [...providersFor(task, custom)];
    if (isCustom && !providers.some((option) => option.value === provider)) {
      providers.push({ value: provider, label: 'Removed provider' });
    }
    return { task, provider, model, providers, models, isCustom };
  }
}

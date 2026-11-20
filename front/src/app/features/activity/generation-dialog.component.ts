import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { DataSourceInfo, GenerationOutput, GenerationSpan } from '@domain/contracts';
import {
  FILL_WITH_DAILY_LABEL,
  contextOptions,
  offersFillWithDaily,
  type GenerationBasis,
  type ScheduleDefaults,
} from '../../core/activity/generation-settings';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

/** Generation asked by the form. */
export interface GenerationChoice {
  readonly basis: GenerationBasis;
  /** Monthly from weekly: fill uncovered days with daily summaries. */
  readonly fillWithDaily: boolean;
  readonly sources: readonly string[];
  readonly outputs: readonly GenerationOutput[];
}

/** Spans the backend generates today. */
const AVAILABLE_SPANS: ReadonlySet<GenerationSpan> = new Set(['daily']);
const OUTPUT_OPTIONS: readonly { value: GenerationOutput; label: string }[] = [
  { value: 'summary', label: 'Summary as a note' },
  { value: 'time', label: 'Fill time entries' },
];

/** Form asking the context and outputs of an activity generation. */
@Component({
  selector: 'ac-generation-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    MultiSelectModule,
    SelectButtonModule,
    ToggleSwitchModule,
  ],
  template: `
    <p-dialog
      [header]="'Generate · ' + periodLabel()"
      [modal]="true"
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [style]="{ width: 'min(520px, 96vw)' }"
    >
      <div class="form">
        @if (hasContextChoice()) {
          <section>
            <h3>Context</h3>
            <p-selectbutton
              [options]="contextChoices()"
              optionValue="value"
              [allowEmpty]="false"
              [ngModel]="basis()"
              (ngModelChange)="basis.set($event)"
              ariaLabel="Context"
            />
            @if (showsFillWithDaily()) {
              <label class="fill">
                <p-toggleswitch
                  [ngModel]="fillWithDaily()"
                  (ngModelChange)="fillWithDaily.set($event)"
                  [ariaLabel]="fillWithDailyLabel"
                />
                {{ fillWithDailyLabel }}
              </label>
            }
          </section>
        }
        @if (usesSources()) {
          <section>
            <h3>Data sources</h3>
            <p-multiselect
              [options]="sourceOptions()"
              optionLabel="label"
              optionValue="key"
              [ngModel]="picked()"
              (ngModelChange)="picked.set($event)"
              display="chip"
              placeholder="Pick data sources"
              appendTo="body"
              ariaLabel="Data sources"
            />
          </section>
        }
        <section>
          <h3>Generate</h3>
          @for (option of outputOptions; track option.value) {
            <label class="output">
              <p-checkbox
                [binary]="true"
                [ngModel]="outputs().includes(option.value)"
                (ngModelChange)="toggleOutput(option.value, $event)"
                [ariaLabel]="option.label"
              />
              <i class="pi pi-bolt" aria-hidden="true"></i>
              {{ option.label }}
            </label>
          }
        </section>
        @if (!isAvailable()) {
          <p class="ac-muted">Only daily generation is available for now.</p>
        }
      </div>
      <ng-template #footer>
        <p-button label="Cancel" [text]="true" (onClick)="visible.set(false)" />
        <p-button
          label="Dry run"
          icon="pi pi-eye"
          [outlined]="true"
          [disabled]="!canGenerate()"
          (onClick)="dryRun.emit(choice())"
        />
        <p-button
          label="Generate"
          icon="pi pi-bolt"
          [disabled]="!canGenerate()"
          (onClick)="submit()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .form {
      display: grid;
      gap: 16px;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 14px;
    }
    p-multiselect {
      width: 100%;
    }
    .fill {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      cursor: pointer;
    }
    .output {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      cursor: pointer;
    }
    .output .pi-bolt {
      color: var(--p-primary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationDialogComponent {
  /** Dialog shown. */
  readonly visible = model(false);
  /** Span of the period. */
  readonly span = input.required<GenerationSpan>();
  /** Name of the period. */
  readonly periodLabel = input.required<string>();
  /** Active data sources. */
  readonly sources = input.required<readonly DataSourceInfo[]>();
  /** Starting choices: the timeline's schedule. */
  readonly defaults = input.required<ScheduleDefaults>();
  /** Generation asked. */
  readonly generate = output<GenerationChoice>();
  /** Prompt preview asked (form stays open). */
  readonly dryRun = output<GenerationChoice>();

  protected readonly outputOptions = OUTPUT_OPTIONS;
  protected readonly fillWithDailyLabel = FILL_WITH_DAILY_LABEL;
  /** Sources as a mutable array (PrimeNG options). */
  protected readonly sourceOptions = computed(() => [...this.sources()]);
  protected readonly basis = signal<GenerationBasis>('generated');
  protected readonly fillWithDaily = signal(false);
  protected readonly picked = signal<readonly string[]>([]);
  protected readonly outputs = signal<readonly GenerationOutput[]>(['summary', 'time']);
  /** Context choices as a mutable array (PrimeNG options). */
  protected readonly contextChoices = computed(() => [...contextOptions(this.span())]);
  protected readonly hasContextChoice = computed(() => this.contextChoices().length > 0);
  protected readonly usesSources = computed(
    () => !this.hasContextChoice() || this.basis() === 'sources',
  );
  protected readonly showsFillWithDaily = computed(() =>
    offersFillWithDaily(this.span(), this.basis()),
  );
  protected readonly isAvailable = computed(() => AVAILABLE_SPANS.has(this.span()));
  protected readonly canGenerate = computed(
    () => this.isAvailable() && this.outputs().length > 0 && this.hasSourcesWhenNeeded(),
  );

  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.reset();
        });
      }
    });
  }

  /**
   * Add or remove an output.
   *
   * @param value - Output.
   * @param checked - Wanted.
   */
  protected toggleOutput(value: GenerationOutput, checked: boolean): void {
    this.outputs.update((current) =>
      checked ? [...current, value] : current.filter((item) => item !== value),
    );
  }

  /** Send the choice and close. */
  protected submit(): void {
    this.generate.emit(this.choice());
    this.visible.set(false);
  }

  /**
   * Choice made in the form.
   *
   * @returns Context, fill toggle, sources and outputs.
   */
  protected choice(): GenerationChoice {
    return {
      basis: this.hasContextChoice() ? this.basis() : 'sources',
      fillWithDaily: this.showsFillWithDaily() && this.fillWithDaily(),
      sources: this.picked(),
      outputs: this.outputs(),
    };
  }

  /**
   * Tell whether the context is complete.
   *
   * @returns True when built from generated summaries or with sources picked.
   */
  private hasSourcesWhenNeeded(): boolean {
    return !this.usesSources() || this.picked().length > 0;
  }

  /** Start from the timeline's schedule (no source picked there: every active source). */
  private reset(): void {
    const defaults = this.defaults();
    const active = this.sources().map((source) => source.key);
    const scheduled = defaults.sources.filter((key) => active.includes(key));
    this.basis.set(defaults.basis);
    this.fillWithDaily.set(defaults.fillWithDaily);
    this.picked.set(scheduled.length > 0 ? scheduled : active);
    this.outputs.set(defaults.outputs);
  }
}

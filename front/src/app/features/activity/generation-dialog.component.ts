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
import type { DataSourceInfo, GenerationSpan } from '@domain/contracts';
import type { GenerationContext } from '../../core/activity/activity-period';
import {
  FILL_WITH_DAILY_LABEL,
  MAX_INSTRUCTION_LENGTH,
  contextOptions,
  offersFillWithDaily,
  type GenerationBasis,
  type ScheduleDefaults,
} from '../../core/activity/generation-settings';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

/** Form asking the context and custom instruction of an activity summary. */
@Component({
  selector: 'ac-generation-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    MultiSelectModule,
    SelectButtonModule,
    TextareaModule,
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
          <h3>Custom instruction</h3>
          <textarea
            pTextarea
            rows="3"
            [autoResize]="true"
            [maxlength]="maxInstructionLength"
            [ngModel]="instruction()"
            (ngModelChange)="instruction.set($event)"
            placeholder="Optional, e.g. write in French, focus on the client project, keep it short"
            aria-label="Custom instruction"
          ></textarea>
        </section>
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
      font-size: calc(14px * var(--ac-font-scale));
    }
    p-multiselect,
    textarea {
      width: 100%;
    }
    .fill {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      cursor: pointer;
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
  readonly generate = output<GenerationContext>();
  /** Prompt preview asked (form stays open). */
  readonly dryRun = output<GenerationContext>();

  protected readonly maxInstructionLength = MAX_INSTRUCTION_LENGTH;
  protected readonly fillWithDailyLabel = FILL_WITH_DAILY_LABEL;
  /** Sources as a mutable array (PrimeNG options). */
  protected readonly sourceOptions = computed(() => [...this.sources()]);
  protected readonly basis = signal<GenerationBasis>('generated');
  protected readonly fillWithDaily = signal(false);
  protected readonly picked = signal<readonly string[]>([]);
  protected readonly instruction = signal('');
  /** Context choices as a mutable array (PrimeNG options). */
  protected readonly contextChoices = computed(() => [...contextOptions(this.span())]);
  protected readonly hasContextChoice = computed(() => this.contextChoices().length > 0);
  protected readonly usesSources = computed(
    () => !this.hasContextChoice() || this.basis() === 'sources',
  );
  protected readonly showsFillWithDaily = computed(() =>
    offersFillWithDaily(this.span(), this.basis()),
  );
  protected readonly canGenerate = computed(() => this.hasSourcesWhenNeeded());

  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          this.reset();
        });
      }
    });
  }

  /** Send the choice and close. */
  protected submit(): void {
    this.generate.emit(this.choice());
    this.visible.set(false);
  }

  /**
   * Choice made in the form.
   *
   * @returns Context, fill toggle, sources and custom instruction.
   */
  protected choice(): GenerationContext {
    return {
      basis: this.hasContextChoice() ? this.basis() : 'sources',
      fillWithDaily: this.showsFillWithDaily() && this.fillWithDaily(),
      sources: this.picked(),
      instruction: this.instruction(),
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
    this.instruction.set(defaults.instruction);
  }
}

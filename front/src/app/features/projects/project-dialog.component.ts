import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ColorPickerModule } from 'primeng/colorpicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { type Project, PROJECT_NAME_MAX_LENGTH } from '@domain/contracts';
import { colorForName } from '@domain/color';
import { NotifyService } from '../../core/notify/notify.service';
import { ProjectsApi } from '../../core/projects/projects.api';
import { AiTextareaComponent } from '../../shared/ui/ai-textarea.component';

/** Create or edit a project (name, color, description). */
@Component({
  selector: 'ac-project-dialog',
  imports: [
    FormsModule,
    ButtonModule,
    ColorPickerModule,
    DialogModule,
    InputTextModule,
    AiTextareaComponent,
  ],
  template: `
    <p-dialog
      [header]="project() ? 'Edit project' : 'New project'"
      [modal]="true"
      [(visible)]="visible"
      [style]="{ width: 'min(520px, 96vw)' }"
    >
      <form class="form" (ngSubmit)="save()">
        <div class="row">
          <label class="field grow">
            <span>Name</span>
            <input
              pInputText
              name="name"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              [maxlength]="maxLength"
              required
            />
          </label>
          <label class="field">
            <span>Color</span>
            <p-colorpicker
              name="color"
              [ngModel]="color()"
              (ngModelChange)="color.set($event)"
              format="hex"
              appendTo="body"
            />
          </label>
        </div>
        <div class="field">
          <span>Description</span>
          <ac-ai-textarea
            [value]="description()"
            (valueChange)="description.set($event)"
            [rows]="3"
            context="This is the description of a research project."
          />
        </div>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button label="Save" icon="pi pi-check" [loading]="saving()" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      display: flex;
      gap: 12px;
      align-items: flex-end;
    }
    .grow {
      flex: 1;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--ac-muted);
    }
    input {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDialogComponent {
  private readonly projects = inject(ProjectsApi);
  private readonly notify = inject(NotifyService);

  /** Visibility (two-way). */
  readonly visible = model(false);
  /** Project to edit (`null` creates). */
  readonly project = input<Project | null>(null);
  /** Emits the saved name (renames change it). */
  readonly saved = output<string>();

  protected readonly name = signal('');
  protected readonly color = signal('#7700a7');
  protected readonly description = signal('');
  protected readonly saving = signal(false);
  protected readonly maxLength = PROJECT_NAME_MAX_LENGTH;

  /** Load the project when the dialog opens. */
  constructor() {
    effect(() => {
      if (this.visible()) {
        untracked(() => {
          const project = this.project();
          this.name.set(project?.name ?? '');
          this.color.set(project?.color ?? colorForName(String(Date.now())));
          this.description.set(project?.description ?? '');
        });
      }
    });
  }

  /** Save. */
  protected async save(): Promise<void> {
    const name = this.name().trim();
    if (name === '' || name.includes('/')) {
      this.notify.warn('Enter a name without "/".');
      return;
    }
    this.saving.set(true);
    try {
      const input = { name, color: this.color(), description: this.description() };
      const project = this.project();
      await (project === null
        ? this.projects.create(input)
        : this.projects.update(project.name, input));
      this.saved.emit(name);
      this.visible.set(false);
    } finally {
      this.saving.set(false);
    }
  }
}

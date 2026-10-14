import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { AiAssistComponent } from './ai-assist.component';
import { MarkdownViewComponent } from './markdown-view.component';

const DEFAULT_ROWS = 4;
const LINE_HEIGHT_EM = 1.5;
const PADDING_REM = 1.1;

/** Text area with a Markdown preview and the AI rewrite toolbar (descriptions and notes). */
@Component({
  selector: 'ac-ai-textarea',
  imports: [FormsModule, ButtonModule, TextareaModule, AiAssistComponent, MarkdownViewComponent],
  template: `
    <div class="field">
      @if (previewing()) {
        <div class="preview" [style.min-height]="minHeight()">
          @if (value().trim() === '') {
            <span class="ac-muted">Nothing to preview.</span>
          } @else {
            <ac-markdown-view [source]="value()" />
          }
        </div>
      } @else {
        <textarea
          pTextarea
          [id]="inputId()"
          [rows]="rows()"
          [autoResize]="true"
          [style.min-height]="minHeight()"
          [placeholder]="placeholder()"
          [ngModel]="value()"
          (ngModelChange)="value.set($event)"
        ></textarea>
      }
      <ac-ai-assist [text]="value()" [context]="context()" (apply)="value.set($event)">
        <p-button
          acToolbarEnd
          [label]="previewing() ? 'Edit' : 'Preview'"
          [icon]="previewing() ? 'pi pi-pencil' : 'pi pi-eye'"
          size="small"
          [text]="true"
          severity="secondary"
          (onClick)="previewing.set(!previewing())"
        />
      </ac-ai-assist>
    </div>
  `,
  styles: `
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    textarea {
      width: 100%;
      resize: vertical;
    }
    .preview {
      padding: 8px 12px;
      border: 1px dashed var(--ac-panel-border);
      border-radius: var(--p-form-field-border-radius, 6px);
      color: var(--p-text-color);
      font-size: 14px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiTextareaComponent {
  /** Two-way bound text. */
  readonly value = model('');
  /** Id of the textarea (for labels). */
  readonly inputId = input('');
  /** Placeholder. */
  readonly placeholder = input('');
  /** Initial rows (also the minimum height). */
  readonly rows = input(DEFAULT_ROWS);
  /** AI context. */
  readonly context = input('');

  protected readonly previewing = signal(false);
  protected readonly minHeight = computed(
    () => `calc(${String(this.rows() * LINE_HEIGHT_EM)}em + ${String(PADDING_REM)}rem)`,
  );
}

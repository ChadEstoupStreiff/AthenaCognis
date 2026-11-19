import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { DataSourceField, DataSourceOption } from '@domain/contracts';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SettingsSection } from '../settings/sections/settings-section';
import { FolderPickerComponent } from './folder-picker.component';
import { addLine, pendingSuggestions } from './lines';
import { maskLines } from './mask-link';

const NOTHING: readonly string[] = [];

/** Settings declared by a data source, rendered as rows (needs a SettingsWriter from the parent). */
@Component({
  selector: 'ac-source-config',
  imports: [
    FormsModule,
    ButtonModule,
    FolderPickerComponent,
    InputTextModule,
    MultiSelectModule,
    TextareaModule,
    ToggleSwitchModule,
  ],
  template: `
    @for (field of fields(); track field.key) {
      <div class="row">
        <div class="label">
          <strong>{{ field.label }}</strong
          ><small class="ac-muted">{{ field.hint }}</small>
        </div>
        @if (field.kind === 'toggle') {
          <p-toggleswitch
            [ngModel]="toggleValue(field)"
            (ngModelChange)="save(field.key, $event, true)"
            [ariaLabel]="field.label"
          />
        } @else if (field.kind === 'text') {
          <input
            pInputText
            [type]="field.secret ? 'password' : 'text'"
            autocomplete="off"
            [ngModel]="textValue(field)"
            (ngModelChange)="save(field.key, $event)"
            [attr.aria-label]="field.label"
          />
        } @else if (field.kind === 'folders') {
          <ac-folder-picker
            [sourceKey]="sourceKey()"
            [label]="field.label"
            [picked]="listValue(field)"
            (pickedChange)="save(field.key, $event, true)"
          />
        } @else if (field.kind === 'lines' && isHidden(field)) {
          <div class="masked">
            @for (link of maskLines(textValue(field)); track $index) {
              <code>{{ link }}</code>
            }
            <p-button
              icon="pi pi-pencil"
              label="Edit"
              size="small"
              [text]="true"
              (onClick)="reveal(field.key)"
              [ariaLabel]="'Edit ' + field.label"
            />
          </div>
        } @else if (field.kind === 'lines') {
          <div class="lines-field">
            <textarea
              pTextarea
              [rows]="2"
              [autoResize]="true"
              [ngModel]="textValue(field)"
              (ngModelChange)="editLines(field, $event)"
              [attr.aria-label]="field.label"
            ></textarea>
            @if (field.secret && textValue(field).trim()) {
              <p-button
                icon="pi pi-eye-slash"
                label="Hide"
                size="small"
                [text]="true"
                (onClick)="conceal(field.key)"
                [ariaLabel]="'Hide ' + field.label"
              />
            }
            @if (suggestions(field); as pending) {
              @if (pending.length > 0) {
                <p-button
                  [icon]="isExpanded(field) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                  iconPos="right"
                  [label]="'Suggested (' + pending.length + ')'"
                  size="small"
                  [text]="true"
                  (onClick)="toggleSuggestions(field.key)"
                  [attr.aria-expanded]="isExpanded(field)"
                  [ariaLabel]="'Suggestions for ' + field.label"
                />
                @if (isExpanded(field)) {
                  <div class="suggestions">
                    @for (option of pending; track option.value) {
                      <p-button
                        icon="pi pi-plus"
                        [label]="option.label"
                        size="small"
                        [outlined]="true"
                        (onClick)="suggest(field, option.value)"
                        [ariaLabel]="'Add ' + option.label"
                      />
                    }
                  </div>
                }
              }
            }
          </div>
        } @else {
          <p-multiselect
            [options]="field.options"
            optionLabel="label"
            optionValue="value"
            [ngModel]="listValue(field)"
            (ngModelChange)="save(field.key, $event, true)"
            display="chip"
            [placeholder]="field.placeholder"
            [filter]="field.options.length > filterThreshold"
            appendTo="body"
            [ariaLabel]="field.label"
          />
        }
      </div>
    }
  `,
  styleUrl: '../settings/sections/section.scss',
  styles: `
    :host {
      display: block;
    }
    .lines-field {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      min-width: min(100%, 320px);
    }
    .lines-field textarea {
      width: 100%;
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
    }
    .masked {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      min-width: 0;
    }
    .masked code {
      max-width: 100%;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceConfigComponent extends SettingsSection {
  /** Fields of the source. */
  readonly fields = input.required<readonly DataSourceField[]>();
  /** Key of the source (folder picker requests). */
  readonly sourceKey = input.required<string>();

  /** Show a search box in multiselects longer than this. */
  protected readonly filterThreshold = 8;

  /** Masks the links of a secret field. */
  protected readonly maskLines = maskLines;

  /** Keys of secret fields opened for editing. */
  private readonly revealed = signal<ReadonlySet<string>>(new Set());

  /** Keys of lines fields with their suggestions unfolded (folded by default). */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  /**
   * Tell whether the suggestions of a field are unfolded.
   *
   * @param field - Lines field.
   * @returns True when unfolded.
   */
  protected isExpanded(field: DataSourceField): boolean {
    return this.expanded().has(field.key);
  }

  /**
   * Fold or unfold the suggestions of a field.
   *
   * @param key - Setting key.
   */
  protected toggleSuggestions(key: string): void {
    this.expanded.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  /**
   * Tell whether a secret field shows its masked links instead of its value.
   *
   * @param field - Field.
   * @returns True when secret, set and not opened for editing.
   */
  protected isHidden(field: DataSourceField): boolean {
    return field.secret && this.textValue(field).trim() !== '' && !this.revealed().has(field.key);
  }

  /**
   * Open a secret field for editing.
   *
   * @param key - Setting key.
   */
  protected reveal(key: string): void {
    this.revealed.update((keys) => new Set(keys).add(key));
  }

  /**
   * Save a lines field; a secret field being typed in stays open.
   *
   * @param field - Field.
   * @param value - New text.
   */
  protected editLines(field: DataSourceField, value: string): void {
    if (field.secret) {
      this.reveal(field.key);
    }
    this.save(field.key, value);
  }

  /**
   * Suggested entries of a lines field not entered yet.
   *
   * @param field - Lines field.
   * @returns Pending suggestions.
   */
  protected suggestions(field: DataSourceField): DataSourceOption[] {
    return pendingSuggestions(field.options, this.textValue(field));
  }

  /**
   * Add a suggested entry to a lines field.
   *
   * @param field - Lines field.
   * @param entry - Suggested value.
   */
  protected suggest(field: DataSourceField, entry: string): void {
    this.save(field.key, addLine(this.textValue(field), entry), true);
  }

  /**
   * Mask a secret field again.
   *
   * @param key - Setting key.
   */
  protected conceal(key: string): void {
    this.revealed.update((keys) => {
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
  }

  /**
   * Current value of a toggle field.
   *
   * @param field - Field.
   * @returns Stored value, or the default when unset.
   */
  protected toggleValue(field: DataSourceField): boolean {
    const value = this.writer.value(field.key);
    return typeof value === 'boolean' ? value : field.default === true;
  }

  /**
   * Current value of a text or lines field.
   *
   * @param field - Field.
   * @returns Stored text, or the default when unset.
   */
  protected textValue(field: DataSourceField): string {
    return this.text(field.key, typeof field.default === 'string' ? field.default : '');
  }

  /**
   * Current value of a multiselect field.
   *
   * @param field - Field.
   * @returns Picked values (stable reference).
   */
  protected listValue(field: DataSourceField): readonly string[] {
    return this.stableList(field.key, Array.isArray(field.default) ? field.default : NOTHING);
  }
}

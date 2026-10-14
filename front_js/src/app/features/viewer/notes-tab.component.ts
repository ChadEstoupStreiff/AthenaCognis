import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FileDetailsApi } from '../../core/files/file-details.api';
import { AutosaveController } from '../../core/state/autosave';
import { AiTextareaComponent } from '../../shared/ui/ai-textarea.component';
import { SaveStatusComponent } from '../../shared/ui/save-status.component';

const NOTE_ROWS = 12;

/** Free-text note attached to a file (indexed by search). */
@Component({
  selector: 'ac-notes-tab',
  imports: [AiTextareaComponent, SaveStatusComponent],
  template: `
    <section class="block">
      <div class="row-actions">
        <h3>Note</h3>
        <ac-save-status [status]="autosave.status()" />
      </div>
      <p class="empty">Notes are searchable (normal and deep search).</p>
      <ac-ai-textarea
        [value]="note()"
        (valueChange)="onChange($event)"
        [rows]="rows"
        placeholder="Write about this file…"
        context="This is a note about a document."
      />
    </section>
  `,
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesTabComponent {
  private readonly details = inject(FileDetailsApi);

  /** Shared path. */
  readonly path = input.required<string>();

  protected readonly note = signal('');
  protected readonly rows = NOTE_ROWS;
  protected readonly autosave = new AutosaveController<{ path: string; note: string }>(
    (value) => this.details.saveNote(value.path, value.note),
    inject(DestroyRef),
  );

  /** Load the note whenever the file changes (pending edits are flushed first). */
  constructor() {
    effect(() => {
      const path = this.path();
      untracked(() => void this.load(path));
    });
  }

  /**
   * Record an edit.
   *
   * @param note - New text.
   */
  protected onChange(note: string): void {
    this.note.set(note);
    this.autosave.schedule({ path: this.path(), note });
  }

  /**
   * Load the note of a file.
   *
   * @param path - Shared path.
   */
  private async load(path: string): Promise<void> {
    await this.autosave.flush();
    const record = await this.details.note(path);
    this.note.set(record.note);
    this.autosave.status.set('idle');
  }
}

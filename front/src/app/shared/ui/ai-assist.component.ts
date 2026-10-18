import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { REWRITE_PRESETS } from '@domain/contracts';
import { AiApi } from '../../core/ai/ai.api';
import { MarkdownViewComponent } from './markdown-view.component';

/** AI rewrite toolbar: Brief / Rewrite / Expand / Ask, with a suggestion to apply or discard. */
@Component({
  selector: 'ac-ai-assist',
  imports: [FormsModule, ButtonModule, InputTextModule, MarkdownViewComponent],
  templateUrl: './ai-assist.component.html',
  styleUrl: './ai-assist.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAssistComponent {
  private readonly ai = inject(AiApi);

  /** Text the AI works on. */
  readonly text = input('');
  /** Reads the text at click time (e.g. the editor selection); defaults to `text`. */
  readonly textSource = input<(() => string) | null>(null);
  /** Context prepended to every instruction (e.g. "This is a markdown note."). */
  readonly context = input('');
  /** Emits the text to apply (replacement). */
  readonly apply = output<string>();

  protected readonly presets = REWRITE_PRESETS;
  protected readonly busy = signal(false);
  protected readonly suggestion = signal<string | null>(null);
  protected readonly asking = signal(false);
  protected readonly question = signal('');

  /**
   * Run a preset or custom instruction.
   *
   * @param instruction - Instruction.
   */
  protected async run(instruction: string): Promise<void> {
    const text = (this.textSource()?.() ?? this.text()).trim();
    if (text === '' || instruction.trim() === '' || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const prefix = this.context().trim();
      this.suggestion.set(
        await this.ai.rewrite(text, prefix === '' ? instruction : `${prefix} ${instruction}`),
      );
      this.asking.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** Apply the suggestion. */
  protected accept(): void {
    const suggestion = this.suggestion();
    if (suggestion !== null) {
      this.apply.emit(suggestion);
      this.suggestion.set(null);
    }
  }

  /** Copy the suggestion to the clipboard. */
  protected async copy(): Promise<void> {
    await navigator.clipboard.writeText(this.suggestion() ?? '');
  }
}

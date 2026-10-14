import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectButtonModule } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import {
  bibtexCitations,
  displayTitle,
  formatApa,
  formatVancouver,
  type Paper,
} from '@domain/sota';
import { triggerDownload } from '../../core/files/files.api';
import { NotifyService } from '../../core/notify/notify.service';

/** Citation style. */
type CitationStyle = 'APA' | 'Vancouver' | 'BibTeX';

const STYLES: Readonly<
  Record<
    CitationStyle,
    { readonly format: (papers: readonly Paper[]) => string; readonly file: string }
  >
> = {
  APA: {
    format: (papers) => formatApa(papers.map((paper) => paper.info)),
    file: 'references_apa.txt',
  },
  Vancouver: {
    format: (papers) => formatVancouver(papers.map((paper) => paper.info)),
    file: 'references_vancouver.txt',
  },
  BibTeX: {
    format: (papers) => bibtexCitations(papers.map((paper) => paper.info)),
    file: 'references.bib',
  },
};

/** Show papers in every citation style, with copy and download. */
@Component({
  selector: 'ac-cite-dialog',
  imports: [FormsModule, ButtonModule, DialogModule, SelectButtonModule],
  template: `
    <p-dialog
      header="Cite"
      [modal]="true"
      [visible]="papers() !== null"
      (visibleChange)="$event ? null : closed.emit()"
      [style]="{ width: 'min(860px, 98vw)' }"
    >
      <div class="cite-head">
        <span class="ac-muted">{{ papers()?.length ?? 0 }} reference(s)</span>
        <p-selectbutton
          [options]="styles"
          [allowEmpty]="false"
          [ngModel]="style()"
          (ngModelChange)="style.set($event)"
          size="small"
          ariaLabel="Citation style"
        />
      </div>
      <pre class="citations">{{ text() }}</pre>
      <ng-template #footer>
        <p-button
          label="Copy"
          icon="pi pi-copy"
          severity="secondary"
          [outlined]="true"
          (onClick)="copy()"
        />
        <p-button [label]="'Download ' + file()" icon="pi pi-download" (onClick)="download()" />
      </ng-template>
    </p-dialog>
  `,
  styleUrl: './research-dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CiteDialogComponent {
  private readonly notify = inject(NotifyService);

  /** Papers to cite (null = closed). */
  readonly papers = input<readonly Paper[] | null>(null);
  /** Emits when closed. */
  readonly closed = output();

  protected readonly styles: CitationStyle[] = ['APA', 'Vancouver', 'BibTeX'];
  protected readonly style = signal<CitationStyle>('APA');
  protected readonly text = computed(() => {
    const papers = [...(this.papers() ?? [])].sort((left, right) =>
      displayTitle(left).localeCompare(displayTitle(right)),
    );
    return STYLES[this.style()].format(this.style() === 'BibTeX' ? (this.papers() ?? []) : papers);
  });
  protected readonly file = computed(() => STYLES[this.style()].file);

  /** Copy the references. */
  protected async copy(): Promise<void> {
    await navigator.clipboard.writeText(this.text());
    this.notify.info('Copied.');
  }

  /** Download the references. */
  protected download(): void {
    const url = URL.createObjectURL(new Blob([this.text()], { type: 'text/plain;charset=utf-8' }));
    triggerDownload(url, this.file());
    setTimeout(() => {
      URL.revokeObjectURL(url);
    });
  }
}

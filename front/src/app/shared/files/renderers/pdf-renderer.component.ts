import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { FilesApi } from '../../../core/files/files.api';

/** PDF in the browser viewer (loaded as a blob so it never turns into a download). */
@Component({
  selector: 'ac-pdf-renderer',
  template: `
    @if (frame(); as url) {
      <iframe class="pdf" [src]="url" [title]="title()"></iframe>
    } @else if (document.isLoading()) {
      <div class="ac-muted"><i class="pi pi-spin pi-spinner"></i> Loading PDF…</div>
    } @else {
      <div class="ac-muted">This PDF could not be loaded.</div>
    }
  `,
  styles: `
    .pdf {
      width: 100%;
      height: var(--pdf-height, 82vh);
      border: none;
      border-radius: 8px;
      background: var(--ac-code-background);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfRendererComponent {
  private readonly files = inject(FilesApi);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private objectUrl: string | null = null;

  /** Shared path. */
  readonly path = input.required<string>();
  /** Frame title. */
  readonly title = input('PDF');

  protected readonly document = resource({
    params: () => this.path(),
    loader: async ({ params }) => {
      const blob = await firstValueFrom(
        this.http.get(this.files.contentUrl(params), { responseType: 'blob' }),
      );
      return new Blob([blob], { type: 'application/pdf' });
    },
  });

  protected readonly frame = signal<SafeResourceUrl | null>(null);

  /** Turn the loaded blob into an object URL (released when the file changes or the view closes). */
  constructor() {
    effect(() => {
      const blob = this.document.value();
      this.release();
      if (blob === undefined) {
        this.frame.set(null);
        return;
      }
      this.objectUrl = URL.createObjectURL(blob);
      this.frame.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    });
    inject(DestroyRef).onDestroy(() => {
      this.release();
    });
  }

  /** Revoke the current object URL. */
  private release(): void {
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

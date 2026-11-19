import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  resource,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { triggerDownload } from '../../core/files/files.api';
import { MailApi } from '../../core/mail/mail.api';
import { type AttachmentPreviewKind, type AttachmentRef, previewType } from './attachment-preview';

/** Longest text shown in the preview (the download keeps the whole file). */
const MAX_TEXT_PREVIEW_CHARS = 200_000;

/** Loaded attachment: blob retyped to the safe preview MIME type. */
interface LoadedAttachment {
  readonly blob: Blob;
  readonly kind: AttachmentPreviewKind;
  readonly text: string | null;
}

/** In-page preview of a mail attachment (image, video, audio, PDF, text) with a download. */
@Component({
  selector: 'ac-mail-attachment-preview',
  imports: [ButtonModule, DialogModule],
  template: `
    <p-dialog
      [header]="attachment().filename"
      [modal]="true"
      [(visible)]="visible"
      [maximizable]="true"
      [dismissableMask]="true"
      [style]="{ width: 'min(1000px, 96vw)' }"
    >
      <div class="preview">
        @if (file.isLoading()) {
          <p class="ac-muted">
            <i class="pi pi-spin pi-spinner"></i> Loading from the mail server…
          </p>
        } @else if (file.error()) {
          <p class="ac-muted">This attachment could not be loaded. Try downloading it.</p>
        } @else if (file.value(); as loaded) {
          @switch (loaded.kind) {
            @case ('image') {
              <img [src]="objectUrl()" [alt]="attachment().filename" />
            }
            @case ('video') {
              <video [src]="objectUrl()" controls></video>
            }
            @case ('audio') {
              <audio [src]="objectUrl()" controls></audio>
            }
            @case ('pdf') {
              @if (frameUrl(); as url) {
                <iframe [src]="url" [title]="attachment().filename"></iframe>
              }
            }
            @case ('text') {
              <pre>{{ loaded.text }}</pre>
            }
          }
        }
      </div>
      <ng-template #footer>
        <p-button label="Download" icon="pi pi-download" (onClick)="download()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .preview {
      display: flex;
      justify-content: center;
      min-height: 120px;
    }
    img,
    video {
      max-width: 100%;
      max-height: 75vh;
      object-fit: contain;
    }
    audio {
      width: 100%;
      align-self: center;
    }
    iframe {
      width: 100%;
      height: 75vh;
      border: none;
      border-radius: 8px;
    }
    pre {
      width: 100%;
      max-height: 75vh;
      margin: 0;
      overflow: auto;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailAttachmentPreviewComponent {
  private readonly mail = inject(MailApi);
  private readonly sanitizer = inject(DomSanitizer);

  /** Attachment shown. */
  readonly attachment = input.required<AttachmentRef>();
  /** Visibility (two-way). */
  readonly visible = model(false);

  protected readonly file = resource({
    params: () => this.attachment(),
    loader: ({ params }) => this.load(params),
  });
  /** Object URL of the loaded blob (revoked when replaced or closed). */
  protected readonly objectUrl = signal<string | null>(null);
  /** Same URL outside the signal graph (the effect must not track what it writes). */
  private currentUrl: string | null = null;
  /** PDF frame source (blob URL of a PDF-typed blob). */
  protected readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.objectUrl();
    return url === null ? null : this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  /** Keep one object URL per loaded file. */
  constructor() {
    effect(() => {
      const loaded = this.file.value();
      this.replaceUrl(loaded === undefined ? null : URL.createObjectURL(loaded.blob));
    });
    inject(DestroyRef).onDestroy(() => {
      this.replaceUrl(null);
    });
  }

  /** Save the file: the loaded blob when ready, else a direct download. */
  protected download(): void {
    const { messageId, index, filename } = this.attachment();
    triggerDownload(this.objectUrl() ?? this.mail.attachmentUrl(messageId, index), filename);
  }

  /**
   * Fetch an attachment and retype it for a safe preview.
   *
   * @param ref - Attachment.
   * @returns Blob, kind and text (text files only).
   * @throws Error when the file type has no preview.
   */
  private async load(ref: AttachmentRef): Promise<LoadedAttachment> {
    const type = previewType(ref.filename);
    if (type === null) {
      throw new Error(`No preview for ${ref.filename}`);
    }
    const blob = new Blob([await this.mail.attachment(ref.messageId, ref.index)], {
      type: type.mime,
    });
    const text = type.kind === 'text' ? (await blob.text()).slice(0, MAX_TEXT_PREVIEW_CHARS) : null;
    return { blob, kind: type.kind, text };
  }

  /**
   * Swap the object URL, revoking the previous one.
   *
   * @param url - New URL, null to drop it.
   */
  private replaceUrl(url: string | null): void {
    if (this.currentUrl !== null) {
      URL.revokeObjectURL(this.currentUrl);
    }
    this.currentUrl = url;
    this.objectUrl.set(url);
  }
}
